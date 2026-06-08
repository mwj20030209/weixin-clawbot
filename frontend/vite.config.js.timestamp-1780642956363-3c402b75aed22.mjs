// vite.config.js
import { defineConfig } from "file:///Applications/%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE%E7%9B%98%EF%BC%88A%EF%BC%89/2026/weixin-ClawBot/weixin-ClawBot-API-main/frontend/node_modules/vite/dist/node/index.js";
import vue from "file:///Applications/%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE%E7%9B%98%EF%BC%88A%EF%BC%89/2026/weixin-ClawBot/weixin-ClawBot-API-main/frontend/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import tailwindcss from "file:///Applications/%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE%E7%9B%98%EF%BC%88A%EF%BC%89/2026/weixin-ClawBot/weixin-ClawBot-API-main/frontend/node_modules/@tailwindcss/vite/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8849",
        changeOrigin: true
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvQXBwbGljYXRpb25zL1x1NjIxMVx1NzY4NFx1OTg3OVx1NzZFRVx1NzZEOFx1RkYwOEFcdUZGMDkvMjAyNi93ZWl4aW4tQ2xhd0JvdC93ZWl4aW4tQ2xhd0JvdC1BUEktbWFpbi9mcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL0FwcGxpY2F0aW9ucy9cdTYyMTFcdTc2ODRcdTk4NzlcdTc2RUVcdTc2RDhcdUZGMDhBXHVGRjA5LzIwMjYvd2VpeGluLUNsYXdCb3Qvd2VpeGluLUNsYXdCb3QtQVBJLW1haW4vZnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0FwcGxpY2F0aW9ucy8lRTYlODglOTElRTclOUElODQlRTklQTElQjklRTclOUIlQUUlRTclOUIlOTglRUYlQkMlODhBJUVGJUJDJTg5LzIwMjYvd2VpeGluLUNsYXdCb3Qvd2VpeGluLUNsYXdCb3QtQVBJLW1haW4vZnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHZ1ZSBmcm9tICdAdml0ZWpzL3BsdWdpbi12dWUnXG5pbXBvcnQgdGFpbHdpbmRjc3MgZnJvbSAnQHRhaWx3aW5kY3NzL3ZpdGUnXG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFt2dWUoKSwgdGFpbHdpbmRjc3MoKV0sXG4gIHNlcnZlcjoge1xuICAgIHByb3h5OiB7XG4gICAgICAnL2FwaSc6IHtcbiAgICAgICAgdGFyZ2V0OiAnaHR0cDovL2xvY2FsaG9zdDo4ODQ5JyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBMmMsU0FBUyxvQkFBb0I7QUFDeGUsT0FBTyxTQUFTO0FBQ2hCLE9BQU8saUJBQWlCO0FBRXhCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxJQUFJLEdBQUcsWUFBWSxDQUFDO0FBQUEsRUFDOUIsUUFBUTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLFFBQ04sUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLE1BQ2hCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
