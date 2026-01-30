
      //@ts-nocheck

      // 自动生成，请勿手动修改
        import { FormResultType } from '@/utils/schema'; // 假设你的基础类型在这里

        export const clonedschema = {
  type: 'group',
  name: 'factory_os',
  label: '未来工厂 4.0 调度总控',
  children: [
    {
      type: 'select',
      name: 'master_power_limit',
      label: '全厂功耗阈值',
      defaultValue: 'unlimited',
      options: [
        {
          label: '不限功耗 (全速模式)',
          value: 'unlimited'
        },
        {
          label: '峰值削减 (节能模式)',
          value: 'eco'
        },
        {
          label: '紧急熔断 (故障模式)',
          value: 'emergency'
        }
      ]
    },
    {
      type: 'group',
      name: 'line_array_a',
      label: 'A 区生产线矩阵',
      children: [
        {
          name: 'a1_power',
          type: 'number',
          defaultValue: 100
        },
        {
          name: 'a2_power',
          type: 'number',
          defaultValue: 100
        },
        {
          name: 'a3_power',
          type: 'number',
          defaultValue: 100
        }
      ]
    },
    {
      type: 'group',
      name: 'line_array_b',
      label: 'B 区物料分配网',
      children: [
        {
          name: 'b1_supply',
          type: 'number',
          defaultValue: 50
        },
        {
          name: 'b2_supply',
          type: 'number',
          defaultValue: 50
        },
        {
          name: 'b3_supply',
          type: 'number',
          defaultValue: 50
        }
      ]
    },
    {
      type: 'group',
      name: 'compensator_matrix',
      label: '动态功率补偿器',
      children: [
        {
          name: 'c1_adjust',
          type: 'number',
          defaultValue: 0
        }
      ]
    },
    {
      type: 'group',
      name: 'final_analytics',
      label: '实时效能分析',
      children: [
        {
          type: 'number',
          name: 'global_efficiency_index',
          label: '📈 全球效能实时指数',
          defaultValue: 0
        }
      ]
    }
  ]
} as const;
      