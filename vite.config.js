import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 仓库：https://github.com/Chunxiaolalala/power-topology-poc
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/power-topology-poc/' : '/',
  plugins: [vue()],
}));
