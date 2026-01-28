const path = require('path');
//  console.log("postcss config");
 
module.exports = ()=>{
    const isQIANKUN = process.env.qiankun === 'true';


     

    const plugins = [
      require('@tailwindcss/postcss')({
        config: path.resolve(__dirname, './tailwind.config.js'),
      }),
      require('autoprefixer'),
    ];

    // if (isQIANKUN) {
    //     plugins.push(
    //       require('postcss-prefix-selector')({
    //         prefix: '.my-prefix',
            
    //         transform(prefix, selector, prefixedSelector, filePath, rule) {
 
    //           if (filePath && filePath.includes('node_modules') && filePath.includes('vuetify')) {
    //             return prefixedSelector;
    //           }
    //           if (filePath && filePath.includes('node_modules')) {
    //             return selector;
    //           }
    //           const annotation = rule.prev();
    //           if (annotation?.type === 'comment' && annotation.text.trim() === 'no-prefix') {
    //             return selector;
    //           }
    //           return selector;
    //         },
    //       })
    //     );

        
    //   }
    
      return { plugins };
}