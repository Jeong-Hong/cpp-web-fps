import base from '../../playwright.game.config.mjs';
export default {...base,testDir:'../../tests/e2e',outputDir:'../../work/direct-url-tests',webServer:undefined,use:{...base.use,baseURL:'http://127.0.0.1:8088'}};
