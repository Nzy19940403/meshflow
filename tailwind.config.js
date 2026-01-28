console.log("tailwind.config.js loaded");
module.exports = {
  corePlugins: {
    preflight: false, // 禁用 Tailwind 的基础重置样式
  },
  important: true,
  content: ["./src/**/*.{vue,js,ts,jsx,tsx,html}"],
  theme: {
    extend: {},
  },
  plugins: [require("tailwindcss-primeui")],
};
