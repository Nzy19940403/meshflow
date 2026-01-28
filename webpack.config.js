const HtmlWebpackPlugin = require("html-webpack-plugin");
const { VueLoaderPlugin } = require('vue-loader')
const path = require('path')
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const { InjectManifest } = require('workbox-webpack-plugin');
const { VuetifyPlugin } = require('webpack-plugin-vuetify')

const SchemaTypePlugin = require('./devPlugin/SchemaTypePlugin');



module.exports = (env, argv) => {
    const isProd = argv.mode === 'production';
    const isQIANKUN = process.env.qiankun === 'true';




    const plugins = [
        new VueLoaderPlugin(),
        new HtmlWebpackPlugin({
            template: './src/index.html'
        }),
        new webpack.DefinePlugin({
            __IS_PROD__: JSON.stringify(isProd),
            // __ENV__: JSON.stringify('dev'),
            __VUE_OPTIONS_API__: JSON.stringify(true),  // 是否支持 Options API，默认 true
            __VUE_PROD_DEVTOOLS__: JSON.stringify(false), // 生产环境是否启用 devtools，默认 false
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false), // 是否启用服务端渲染不匹配详情，默认 false
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, 'serve.json'),
                    to: path.resolve(__dirname, 'dist', 'serve.json'),
                },
            ],
        }),
        new MiniCssExtractPlugin({
            filename: 'primeui.[contenthash].css',  // 生成文件名
        }),
        new VuetifyPlugin({
            autoImport: true,
            styles: false
        }),
        new SchemaTypePlugin()

    ]

    if (!isQIANKUN) {
        plugins.push(
            new webpack.container.ModuleFederationPlugin({
                name: 'remoteApp',
                filename: 'remoteEntry.js',
                exposes: {
                    './RemoteButtonNavigation': './src/components/CustomButtonNavigation.vue',
                    './CustomForm': './src/components/CustomForm/CustomForm.vue',
                    './schema': './devSchemaConfig/dev.form.Schema.js',
            
                },
                shared: {
                    vue: {
                        singleton: true,
                        //   eager: true,
                        //   requiredVersion: '^3.5.17'
                    },
                    vuetify: {
                        singleton: true
                    },
                }
            })
        )
    }

     
    if (isProd) {
        plugins.push(
            new InjectManifest({
                // 必填项 1: Service Worker 模板文件路径
                // 这是您定义缓存策略、路由和生命周期逻辑的源文件
                swSrc: path.resolve(__dirname, 'sw-template.js'),

                // 必填项 2: 最终生成的 Service Worker 文件名和路径
                // Workbox 会将这个文件输出到您的 Webpack output 目录
                swDest: 'sw.js',
                exclude: [
                    /\.map$/,                      // 排除所有 Source Map 文件
                    /hot-update\.js$/,             // 排除所有 .hot-update.js 文件
                    /hot-update\.json$/,           // 排除所有 .hot-update.json 文件

                ],

            }),
        )
    }

    return {
        entry: isQIANKUN ? "./src/mainqiankun.js" : "./src/main.js",
        output: {
            filename: 'bundle.[contenthash].js',
            path: path.resolve(__dirname, 'dist'),
            clean: true,             // 每次构建清除 dist 目录
            library: 'vueApp',             // 👈 必须和主应用中注册的 name 一致
            libraryTarget: 'umd',
            globalObject: 'window',
            chunkLoadingGlobal: 'webpackJsonp_vueApp',
            publicPath:'/'
        },
        plugins,
        module: {
            rules: [
                {
                    test: /\.vue$/,
                    loader: 'vue-loader'
                },
                {
                    test: /\.js$/,
                    loader: 'babel-loader',
                    exclude: /node_modules/
                },
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,

                    use: [
                        {
                            loader: 'ts-loader',
                            options: {
                                appendTsSuffixTo: [/\.vue$/], // Vue SFC 的 <script lang="ts">
                                transpileOnly: true           // 不做类型检查，加速
                            }
                        }
                    ]
                },
                {
                    test: /tailwind-primeui\.css$/,
                    use: [
                        {
                            loader: MiniCssExtractPlugin.loader,
                        },
                        {
                            loader: 'css-loader',
                            options: {
                                import: false,
                                // url:    false,   //    同时忽略 url()
                            },
                        },
                        {
                            loader: 'string-replace-loader',
                            options: {
                                search: /primeui\//g,     // 只匹配引号或 ( 之后的 primeui/
                                replace: 'https://cdn.jsdelivr.net/npm/tailwindcss-primeui@0.6.1/v4/', // 你的 CDN 前缀
                            }
                        }
                    ],
                },
                {
                    test: /\.css$/,
                    exclude: /tailwind-primeui\.css$/,
                    use: [
                        (isProd || isQIANKUN) ? MiniCssExtractPlugin.loader : 'style-loader', ,
                        'css-loader',
                        'postcss-loader'
                    ]
                },


            ]
        },
        devServer: {
            port: 9000,
            compress: true,
            hot: false,
            // liveReload: false,

            headers: {
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*', // ⭐️ 允许所有域访问（开发模式用 * 就行）
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
                'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization'
            },
            historyApiFallback: true,
        },
        resolve: {
            extensions: ['.ts', '.js', '.d.ts'],
            // conditionNames: ['style', 'import', 'require', 'default'],
            alias: {
                // ⬇︎把一切以 primeui/ 开头的“模块请求”重写到 CDN
                'primeui': 'https://cdn.jsdelivr.net/npm/primeui@latest',
                '@': path.resolve(__dirname, './'),
            },
        },
        mode: argv.mode || 'development',
        devtool: 'source-map',
    }


};