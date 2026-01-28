const fs = require('fs');
const path = require('path');

 
const { file } = require('zod');
const { stringify } = require('javascript-stringify');

class SchemaTypePlugin {
    constructor(options={}){
        this.watchDir = path.resolve(options.watchDir||'./devSchemaConfig');
        this.isGenerated = false;
    }

    generateDataFile(schemaCode,filePath){
      const typeDefinition = `
      //@ts-nocheck

      // 自动生成，请勿手动修改
        import { FormResultType } from '@/utils/schema'; // 假设你的基础类型在这里

        export const clonedschema = ${schemaCode} as const;
      `;
      const outputPath = filePath.replace(/\.js$/, '.data.ts'); // 生成在原文件旁边，例如 login.schema.ts.d.ts

      fs.writeFileSync(outputPath, typeDefinition);
  
    }

    generateCheckFile(filePath){

      const basename = path.parse(filePath).name;

      const outputPath = path.join(path.dirname(filePath), `${basename}.check.ts`);

      const typeDefinition = `
 

      // 自动生成，请勿手动修改
        import { FormResultType } from '@/utils/schema'; // 假设你的基础类型在这里
        import {clonedschema} from './${basename}.data';
        import { GetAllPath } from '@/utils/util';

        export type FormDataModel = FormResultType<typeof clonedschema>
        export type AllPath = GetAllPath<FormDataModel>;
     
      `;
    

      fs.writeFileSync(outputPath, typeDefinition);
      
    }

    generateSingle(filePath) {
        try {
          // 这里的关键：清除 Node 的缓存，否则读取的是旧内容
          delete require.cache[require.resolve(filePath)];
          const module = require(filePath);
          // 假设你 export 的是 MySchema
          const schema = module.Schema || module.default;
    
          const schemaCode = stringify(schema, null, 2)

          if (schema) {
            this.generateDataFile(schemaCode,filePath)
            this.generateCheckFile(filePath)
          }
        } catch (e) {
          console.error(`[SchemaType] Error parsing ${filePath}:`, e.message);
        }
      }

    apply(compiler){

 
        // 针对开发模式 (Dev Server)
        compiler.hooks.watchRun.tap('SchemaTypePlugin', () => {
        if (!this.isGenerated) {
            console.log('[SchemaTypePlugin] 开发模式启动，开始初次生成...');
            this.generateAll();
            this.isGenerated = true;
            }
        });
      
    }

    generateAll() { 
      
        const files = fs.readdirSync(this.watchDir).filter(f => f.endsWith('.Schema.js'));
        console.log('ccccccccccccccc')
  
      
        files.forEach(f => this.generateSingle(path.join(this.watchDir, f)));
    }
}

module.exports = SchemaTypePlugin;