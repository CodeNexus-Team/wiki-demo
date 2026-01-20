import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 自动扫描 source-code 目录的 Vite 插件
function sourceCodeScannerPlugin(): Plugin {
  return {
    name: 'source-code-scanner',
    configureServer(server) {
      server.middlewares.use('/api/source-code/files', (_req, res) => {
        const sourceCodeDir = path.join(__dirname, 'public', 'source-code');
        const files: string[] = [];

        function scanDir(dir: string, relativePath: string = '') {
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

              if (entry.isDirectory()) {
                // 递归扫描子目录
                scanDir(fullPath, relPath);
              } else if (entry.isFile() && entry.name !== 'manifest.json') {
                // 添加文件到列表（排除 manifest.json）
                files.push(relPath);
              }
            }
          } catch (error) {
            console.error(`Error scanning directory ${dir}:`, error);
          }
        }

        scanDir(sourceCodeDir);

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ files }));
      });
    }
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), sourceCodeScannerPlugin()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'import.meta.env.VITE_CODENEXUS_API_URL': JSON.stringify(env.VITE_CODENEXUS_API_URL)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
