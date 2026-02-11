// 模拟 10 个集群组，每个组都有独立的异步联动逻辑
const generateAsgGroups = (count) => {
  return Array.from({ length: count }).map((_, i) => ({
    type: 'group',
    name: `asg_${i}`,
    label: `弹性集群 - 节点池 ${String.fromCharCode(65 + i)}`,
    children: [
      {
        type: 'select',
        name: `instance_${i}`,
        label: '实例规格',
        value: 'general',
        options: [
          { label: '通用型 (g6)', value: 'general' },
          { label: '计算型 (c6)', value: 'compute' },
          { label: 'GPU型 (gn7)', value: 'gpu' }
        ],
        // 这里的 message 会受全局合规影响
      },
      {
        type: 'number',
        name: `count_${i}`,
        label: '副本数量',
        value: 2,
        min: 1,
        max: 100
      },
      {
        type: 'select',
        name: `storage_${i}`,
        label: '存储介质',
        value: 'ssd',
        options: [
          { label: 'ESSD 增强型', value: 'essd' },
          { label: '标准 SSD', value: 'ssd' }
        ]
      }
    ]
  }));
};

export const Schema = {
  type: 'group',
  name: 'cloudConsole',
  label: '云资源采购中心 (专家版)',
  children: [
    // --- 部署环境：控制全局合规 ---
    {
      type: 'group',
      name: 'environment',
      label: '环境与合规策略',
      children: [
        {
          type: 'select',
          name: 'region',
          label: '部署地域',
          value: 'china',
          required: true, 
          options: [
            { label: '中国大陆 (华北、华东、华南)', value: 'china' },
            { label: '全球海外 (香港、新加坡、美国)', value: 'global' }
          ]
        },
        {
          type: 'select',
          name: 'compliance',
          label: '合规性分级',
          value: 'standard',
          required: true, 
          options: [
            { label: 'Level 1: 标准合规 (Standard)', value: 'standard' },
            { label: 'Level 2: 高安全性 (High Security)', value: 'high_security' },
            { label: 'Level 3: 金融级监管 (Financial)', value: 'financial' }
          ],
          description: '合规等级越高，可选资源规格越严格'
        }
      ]
    },
    // --- 规格选配：深度联动区 ---
    {
      type: 'group',
      name: 'specs',
      label: '核心资源配置',
      children: [
        {
          type: 'select',
          name: 'instanceFamily',
          label: '实例家族',
          value: 'general',
          required:true,
          // 这里的 options 是全量的，但 Engine 会根据合规性动态过滤它
          options: [
            { label: '通用型 (g6)', value: 'general' },
            { label: '计算型 (c6)', value: 'compute' },
            { label: 'GPU 训练型 (gn7)', value: 'gpu' },
            { label: '高 IO 型 (i3)', value: 'high_io' }
          ],
          message: '' // 动态提示，如：“当前合规等级不支持 GPU 实例”
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
              value: 'ssd',
              required: true, 
              options: [
                { label: 'ESSD 增强型 SSD', value: 'essd' },
                { label: '标准 SSD', value: 'ssd' },
                { label: '高效云盘 (HDD)', value: 'hdd' }
              ]
            },
            {
              type: 'number',
              name: 'capacity',
              label: '系统盘容量 (GB)',
              value: 40,
              min: 20, // 动态修改为 100
              max: 32768,
              step: 10,
              required: true, 
              message: '' // 动态提示，如：“计算型实例需搭配 100GB 以上空间”
            }
          ]
        }
      ]
    },
    // --- 安全策略：条件弹出区 ---
    {
      type: 'group',
      name: 'security',
      label: '安全加固选项',
      children: [
        {
          type: 'select',
          name: 'encryption',
          label: '数据盘加密',
          value: 'no',
          required: true, 
          options: [
            { label: '开启落盘加密 (KMS)', value: 'yes' },
            { label: '暂不开启', value: 'no' }
          ]
        },
        {
          type: 'input',
          name: 'kmsKey',
          label: 'KMS 密钥 ID',
          value: '',
          maxLength:8,
          hidden: true, // 只有加密为 yes 才显示
          required: false, // 只有加密为 yes 才必填
          placeholder: '请输入云平台提供的密钥 UUID'
        }
      ]
    },
    // {
    //   type: 'group',
    //   name: 'step_clusters',
    //   label: '2. 弹性伸缩集群配置',
    //   // 这里放入生成的 10 个组
    //   children: generateAsgGroups(10) 
    // },
    // --- 动态汇总：计算结果区 ---
    {
      type: 'group',
      name: 'billing',
      label: '计费与汇总',
      children: [
        {
          type: 'number',
          name: 'totalPrice',
          label: '预估月度总价',
          value: 0,
          readonly: true,
          required: true, 
          prefix: '￥'
        },
        {
          type: 'input',
          name: 'priceDetail',
          label: '计费项说明',
          value: '基础配置费用',
          readonly: true,
          required: false, 
          hidden: false
        },
        {
          type: 'checkbox', // UI 对应 Vuetify 的 v-checkbox 或 v-switch
          name: 'autoRenew',
          label: '开启自动续费',
          value: false, // 默认不开启
          disabled: false, 
          description: '暂不支持自动续费'
        },
      ]
    }
  ]
};
 
 
 