import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/e2e',timeout:30000,workers:1,fullyParallel:false,
 outputDir:'./work/browser',reporter:[['list']],
 use:{channel:'chrome',headless:true,viewport:{width:1440,height:900},screenshot:'only-on-failure',trace:'retain-on-failure'},
});
