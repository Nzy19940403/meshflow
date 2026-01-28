<template>
  <div class="w-full h-full flex flex-column">
 
    <div class="d-flex align-center px-2 py-1 bg-slate-900 border-b-thin">
      <v-btn
        icon="mdi-arrow-left"
        variant="text"
        density="comfortable"
        @click="goBack"
      ></v-btn>
      <v-divider vertical class="mx-2 my-2"></v-divider>
      <span class="text-caption font-weight-bold">TOPOLOGY VIEW</span>
      <v-spacer></v-spacer>
      <span class="text-grey-darken-1 text-caption mr-4">
        按拓扑序从上至下执行计算流
      </span>
    </div>
    <v-card>
      <template v-slot:text>
        此图展示了当前表单字段的逻辑联动顺序,
        可以帮助你排查联动卡死或赋值逻辑错误。
      </template>
    </v-card>
    <div class="flex flex-grow-1">
      <div class="flex-grow-1 relative" ref="containerRef"></div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useEngine } from "@/utils/hooks/useEngineManager";
import { useRouter } from "vue-router";
import rough from "roughjs";
import { onMounted } from "vue";
import { shallowRef } from "vue";
import { watch } from "vue";
import { useElementSize, watchDebounced } from "@vueuse/core";
import { nextTick } from "vue";
import { AllPath } from "@/devSchemaConfig/dev.form.Schema.check";
import { Graph } from "@antv/g6";

const router = useRouter();

const engine = useEngine('main-engine');

const containerRef = shallowRef();

let graphInstance: any = null;

// let bindEvent: boolean = false;

const { width, height } = useElementSize(containerRef);

console.log(engine.dependency.GetAllDependency());
console.log(engine.dependency.GetDependencyOrder());

const renderG6Graph = (container: any, graphData: any) => {
  if (graphInstance) {
    graphInstance.setData(graphData);
    graphInstance.render();
    return;
  }

  graphInstance = new Graph({
    container: container,
    width: container.clientWidth,
    height: container.clientHeight,
    autoFit: {
      type: "view", // 自适应类型：'view' 或 'center'
      options: {
        // 仅适用于 'view' 类型
        when: "overflow", // 何时适配：'overflow'(仅当内容溢出时) 或 'always'(总是适配)
        direction: "both", // 适配方向：'x'、'y' 或 'both'
      },
      animation: {
        // 自适应动画效果
        duration: 1000, // 动画持续时间(毫秒)
        easing: "ease-in-out", // 动画缓动函数
      },
    },
    // 5.0 核心配置：直接传入数据
    data: graphData,
    layout: {
      type: "dagre",
      rankdir: "TB",
      nodesep: 50,
      ranksep: 100,
      controlPoints: true, // 配合 polyline 生成折线拐点
    },

    // 全局节点配置
    node: {
      type: "rect",
      style: {
        size: [200, 40],
        anchorPoints: [
          [0.5, 0],
          [0.5, 1],
        ],
        // 关键：d 对应你 nodes 数组里的每一个元素
        // 你把名称存在了 data.label 里，所以这里要这样取：
        labelText: (d: any) => d.data.label,

        // 样式补丁：确保文字可见
        labelFill: "#cbd5e1", // 淡灰色文字，阅读体验最好
        labelFontSize: 12, // 文字大小
        labelPlacement: "center", // 文字位置

        shadowColor: "rgba(0, 0, 0, 0.5)",
        fill: "#1e293b", // 深色填充
        stroke: "#3b82f6", // 蓝色细边框，或者用透明，只在选中时高亮
        lineWidth: 1,
        radius: 4,
      },
      state: {
        selected: {
          fill: "#2563eb", // 选中时变成明亮的蓝色
          labelFill: "#ffffff",
          shadowColor: "#3b82f6",
          shadowBlur: 15, // 选中时有“霓虹灯”发光效果
          stroke: "#60a5fa",
        },
      },
    },
    // 全局连线配置
    edge: {
      type: "cubic-vertical",
      style: {
        stroke: "#475569",
        lineWidth: 1.5,
        radius: 10, // 折线圆角
        endArrow: true, // 箭头
        strokeOpacity: 0.3, // 默认颜色要浅！这是多节点图不乱的关键
      },
      state: {
        active: {
          stroke: "#60a5fa", // 激活时亮蓝色
          strokeOpacity: 1,
          lineWidth: 2,
          labelFill: "#60a5fa",
        },
        inactive: {
          strokeOpacity: 0.05, // 没被选中的线几乎消失
        },
      },
    },
    // 交互行为：没有这个你点不动也缩放不了
    behaviors: [
      "drag-canvas",
      "zoom-canvas",
      "drag-node",
      "click-select",
      "hover-activate",
    ],
  });

  graphInstance.render();
};

const prepareData = () => {
  // 获取拓扑排序后的层级，levels 是 string[][]
  const levels = engine.dependency.GetDependencyOrder();

  const nodes: any = [];
  const edges: any = [];
  const processedNodes = new Set();

  // 1. 处理节点 (Nodes)
  // 我们直接遍历 levels，这样可以确保图中包含所有在依赖链中的路径
  levels.forEach((level) => {
    level.forEach((path: string) => {
      if (!processedNodes.has(path)) {
        nodes.push({
          id: path, // 唯一标识，必须是字符串
          data: {
            // 将业务数据存在 data 里，方便后续 labelText 读取
            label: path.split(".").slice(-2).join("."),
            fullPath: path,
          },
        });
        processedNodes.add(path);
      }
    });
  });

  // 2. 处理连线 (Edges)
  // 遍历你的 dependencyMap (假设结构是 Map<string, Set<string> | string[]>)
  engine.dependency.GetAllDependency().forEach((targets, fromPath) => {
    // 只有当起点在我们的节点列表中时才连线
    if (processedNodes.has(fromPath)) {
      targets.forEach((toPath: string) => {
        // 只有当终点也在节点列表中时才连线（防止悬空线导致报错）
        if (processedNodes.has(toPath)) {
          edges.push({
            source: fromPath,
            target: toPath,
            // 你可以给边也加点数据
            data: {
              type: "dependency",
            },
          });
        }
      });
    }
  });

  return { nodes, edges };
};

const drawCanvas = () => {
  let data = prepareData();
  renderG6Graph(containerRef.value, data);
};

const goBack = () => {
  router.back();
};

onMounted(async () => {
  
});
watchDebounced(
  [width, height],
  () => {
    drawCanvas();
  },
  { debounce: 250, maxWait: 500 } // maxWait 确保即使动画很长也会在 500ms 后强制画一次
);
</script>
