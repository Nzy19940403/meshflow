
      //@ts-nocheck

      // 自动生成，请勿手动修改
        import { FormResultType } from '@/utils/schema'; // 假设你的基础类型在这里

        export const clonedschema = {
  type: 'group',
  name: 'enterpriseCloud',
  label: '企业级混合云控制台',
  children: [
    {
      type: 'group',
      name: 'infra',
      label: '全球基础设施',
      children: [
        {
          type: 'select',
          name: 'provider',
          label: '云服务商',
          defaultValue: 'aws',
          options: [
            {
              label: 'AWS Global',
              value: 'aws'
            },
            {
              label: 'Alibaba Cloud',
              value: 'aliyun'
            },
            {
              label: 'Azure Stack (Private)',
              value: 'azure_private'
            }
          ]
        },
        {
          type: 'select',
          name: 'siteSelection',
          label: '站点与合规边界',
          defaultValue: 'domestic',
          options: [
            {
              label: '中国大陆 (等保三级可用区)',
              value: 'domestic'
            },
            {
              label: '海外 (GDPR 覆盖区)',
              value: 'overseas_gdpr'
            },
            {
              label: '离岸 (免税试验区)',
              value: 'offshore'
            }
          ]
        }
      ]
    },
    {
      type: 'group',
      name: 'computePool',
      label: '弹性计算资源池',
      children: [
        {
          type: 'select',
          name: 'workloadType',
          label: '业务负载类型',
          defaultValue: 'web',
          options: [
            {
              label: 'Web 应用 (通用)',
              value: 'web'
            },
            {
              label: '大数据分析 (高算力)',
              value: 'bigdata'
            },
            {
              label: 'AI/训练 (GPU 密集)',
              value: 'ai'
            },
            {
              label: '冷数据归档',
              value: 'archive'
            }
          ]
        },
        {
          type: 'select',
          name: 'instanceType',
          label: '实例详细规格',
          defaultValue: 'm5.large',
          options: [
            {
              label: 'm5.large (2C8G)',
              value: 'm5.large',
              category: 'web'
            },
            {
              label: 'p3.16xlarge (8*V100)',
              value: 'p3.gpu',
              category: 'ai'
            },
            {
              label: 'r5.extra (高内存)',
              value: 'r5.mem',
              category: 'bigdata'
            }
          ]
        },
        {
          type: 'group',
          name: 'storageMatrix',
          label: '分布式存储矩阵',
          children: [
            {
              type: 'number',
              name: 'iopsSet',
              label: '预置 IOPS',
              defaultValue: 3000,
              min: 100,
              max: 50000
            },
            {
              type: 'checkbox',
              name: 'multiAzReplication',
              label: '跨可用区容灾',
              defaultValue: false
            }
          ]
        }
      ]
    },
    {
      type: 'group',
      name: 'finance',
      label: '财务审计与阶梯计费',
      children: [
        {
          type: 'select',
          name: 'currency',
          label: '结算币种',
          defaultValue: 'CNY',
          options: [
            {
              label: '人民币 (CNY)',
              value: 'CNY'
            },
            {
              label: '美元 (USD)',
              value: 'USD'
            },
            {
              label: '欧元 (EUR)',
              value: 'EUR'
            }
          ]
        },
        {
          type: 'number',
          name: 'exchangeRate',
          label: '当前实时汇率',
          defaultValue: 1,
          readonly: true
        },
        {
          type: 'number',
          name: 'totalMonthlyCost',
          label: '月度预估总额',
          defaultValue: 0,
          readonly: true,
          prefix: '💰'
        }
      ]
    }
  ]
} as const;
      