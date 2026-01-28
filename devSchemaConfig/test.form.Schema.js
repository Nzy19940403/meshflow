export const Schema = {
    "type": "group",
    "name": "factory_os",
    "label": "未来工厂 4.0 调度总控",
    "children": [
      // --- 核心变量：所有联动的中枢 ---
      {
        "type": "select",
        "name": "master_power_limit",
        "label": "全厂功耗阈值",
        "defaultValue": "unlimited",
        "options": [
          { "label": "不限功耗 (全速模式)", "value": "unlimited" },
          { "label": "峰值削减 (节能模式)", "value": "eco" },
          { "label": "紧急熔断 (故障模式)", "value": "emergency" }
        ]
      },
  
      // --- 阵列 A：生产线集群 (A1 - A50) ---
      // 每个节点都依赖 master_power_limit，并计算出自己的可用功率
      {
        "type": "group",
        "name": "line_array_a",
        "label": "A 区生产线矩阵",
        "children": [
          {
            "name": "a1_power",
            "type": "number",
            "defaultValue": 100,
          },
          // ... 此处请手动/脚本复制至 a50_power ...
          { "name": "a2_power", "type": "number", "defaultValue": 100 },
          { "name": "a3_power", "type": "number", "defaultValue": 100 }
        ]
      },
  
      // --- 阵列 B：原料分配逻辑 (B1 - B50) ---
      // 这里的“绕”点：B1 不仅看 master_power_limit，还要看 A1 的计算结果
      {
        "type": "group",
        "name": "line_array_b",
        "label": "B 区物料分配网",
        "children": [
          {
            "name": "b1_supply",
            "type": "number",
            "defaultValue": 50,
          },
          // ... 此处复制至 b50_supply ...
          { "name": "b2_supply", "type": "number", "defaultValue": 50 },
          { "name": "b3_supply", "type": "number", "defaultValue": 50 }
        ]
      },
  
      // --- 核心绕路点：交叉补偿逻辑 ---
      // C1 依赖 A1, B2；C2 依赖 A2, B3... 这种交叉让拓扑排序变得极其复杂
      {
        "type": "group",
        "name": "compensator_matrix",
        "label": "动态功率补偿器",
        "children": [
          {
            "name": "c1_adjust",
            "type": "number",
            "defaultValue": 0,
          }
          // ... 此处复制至 c50_adjust ...
        ]
      },
  
      // --- 终极汇聚：全厂能效指数 (The Ultimate Diamond) ---
      {
        "type": "group",
        "name": "final_analytics",
        "label": "实时效能分析",
        "children": [
          {
            "type": "number",
            "name": "global_efficiency_index",
            "label": "📈 全球效能实时指数",
            "defaultValue": 0,
          }
        ]
      }
    ]
  }