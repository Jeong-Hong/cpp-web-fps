import base from './playwright.config.mjs';
import {defineConfig} from '@playwright/test';
export default defineConfig({...base,testMatch:'game.spec.mjs',testIgnore:[],timeout:45000,
 outputDir:'./work/game-tests',use:{...base.use,baseURL:'http://127.0.0.1:8098'},
 webServer:{command:'node server/main.mjs --port 8098',url:'http://127.0.0.1:8098/health',reuseExistingServer:false,timeout:20000},
});
