
      //@ts-nocheck

      // 自动生成，请勿手动修改
        import { FormResultType } from '@/utils/schema'; // 假设你的基础类型在这里

        export const clonedschema = {
  type: 'group',
  name: 'cloudConsole',
  label: '云资源采购中心 (专家版)',
  children: [
    {
      type: 'group',
      name: 'environment',
      label: '环境与合规策略',
      children: [
        {
          type: 'select',
          name: 'region',
          label: '部署地域',
          defaultValue: 'china',
          required: true,
          options: [
            {
              label: '中国大陆 (华北、华东、华南)',
              value: 'china'
            },
            {
              label: '全球海外 (香港、新加坡、美国)',
              value: 'global'
            }
          ]
        },
        {
          type: 'select',
          name: 'compliance',
          label: '合规性分级',
          defaultValue: 'standard',
          required: true,
          options: [
            {
              label: 'Level 1: 标准合规 (Standard)',
              value: 'standard'
            },
            {
              label: 'Level 2: 高安全性 (High Security)',
              value: 'high_security'
            },
            {
              label: 'Level 3: 金融级监管 (Financial)',
              value: 'financial'
            }
          ],
          description: '合规等级越高，可选资源规格越严格'
        }
      ]
    },
    {
      type: 'group',
      name: 'specs',
      label: '核心资源配置',
      children: [
        {
          type: 'select',
          name: 'instanceFamily',
          label: '实例家族',
          defaultValue: 'general',
          required: true,
          options: [
            {
              label: '通用型 (g6)',
              value: 'general'
            },
            {
              label: '计算型 (c6)',
              value: 'compute'
            },
            {
              label: 'GPU 训练型 (gn7)',
              value: 'gpu'
            },
            {
              label: '高 IO 型 (i3)',
              value: 'high_io'
            }
          ],
          message: ''
        },
        {
          type: 'group',
          name: 'storage',
          label: '存储方案',
          children: [
            {
              type: 'select',
              name: 'diskType',
              label: '系统盘类型',
              defaultValue: 'ssd',
              required: true,
              options: [
                {
                  label: 'ESSD 增强型 SSD',
                  value: 'essd'
                },
                {
                  label: '标准 SSD',
                  value: 'ssd'
                },
                {
                  label: '高效云盘 (HDD)',
                  value: 'hdd'
                }
              ]
            },
            {
              type: 'number',
              name: 'capacity',
              label: '系统盘容量 (GB)',
              defaultValue: 40,
              min: 20,
              max: 32768,
              step: 10,
              required: true,
              message: ''
            }
          ]
        }
      ]
    },
    {
      type: 'group',
      name: 'security',
      label: '安全加固选项',
      children: [
        {
          type: 'select',
          name: 'encryption',
          label: '数据盘加密',
          defaultValue: 'no',
          required: true,
          options: [
            {
              label: '开启落盘加密 (KMS)',
              value: 'yes'
            },
            {
              label: '暂不开启',
              value: 'no'
            }
          ]
        },
        {
          type: 'input',
          name: 'kmsKey',
          label: 'KMS 密钥 ID',
          defaultValue: '',
          maxLength: 8,
          hidden: true,
          required: false,
          placeholder: '请输入云平台提供的密钥 UUID'
        }
      ]
    },
    {
      type: 'group',
      name: 'billing',
      label: '计费与汇总',
      children: [
        {
          type: 'number',
          name: 'totalPrice',
          label: '预估月度总价',
          defaultValue: 0,
          readonly: true,
          required: true,
          prefix: '￥'
        },
        {
          type: 'input',
          name: 'priceDetail',
          label: '计费项说明',
          defaultValue: '基础配置费用',
          readonly: true,
          required: false,
          hidden: false
        },
        {
          type: 'checkbox',
          name: 'autoRenew',
          label: '开启自动续费',
          defaultValue: false,
          disabled: false,
          description: '暂不支持自动续费'
        }
      ]
    }
  ]
} as const;
      