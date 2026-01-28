// export function generateTypeString(schema) {
//     // 模拟你的 handler + merge 逻辑
//     const parseToType = (node) => {
//        // 1. 如果是 group
//        if (node.type === 'group') {
//          const isFlatten = node.name === ''; // 对应你代码里的 obj.key === ''
         
//          // 处理子节点
//          const childrenTypes = (node.children || []).map((child) => parseToType(child));
   
//          if (isFlatten) {
//            // 如果是展平组，返回所有子节点的键值对字符串（不带大括号）
//            return childrenTypes.join('\n');
//          } else {
//            // 如果有名字，包裹一层大括号，并对应 key
//            return `${node.name}: {\n${childrenTypes.map((line) => '  ' + line).join('\n')}\n}`;
//          }
//        }
   
//        // 2. 如果是基础字段 (input/number/select)
//        const typeMap= {
//          'input': 'string',
//          'number': 'number',
//          'select': 'any', // 这里可以根据你的 defaultValue 进一步判断
//        };
//        const tsType = typeMap[node.type] || 'any';
//        return `${node.name}: ${tsType};`;
//      };
   
//      // 这里的 schema 通常是根节点
//      const result = parseToType(schema);
   
//      // 包装成最终的 interface
//      // 如果根节点是展平的，result 已经是一堆键值对了
//      return `export interface FormModel {\n${result}\n}`;
//    }