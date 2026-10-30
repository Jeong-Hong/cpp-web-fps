import { defineConfig } from '@playwright/test';
import {mkdirSync} from 'node:fs';
const scratch='D:/Tools/Hermes/profiles/omh/cache/scratch';
mkdirSync(scratch,{recursive:true});
for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=scratch;
export default defineConfig({
 testDir:'./tests/e2e',testIgnore:'game.spec.mjs',timeout:30000,workers:1,fullyParallel:false,
 outputDir:'./work/browser',reporter:[['list']],
 use:{channel:'chrome',headless:true,viewport:{width:1440,height:900},screenshot:'only-on-failure',trace:'retain-on-failure'},
});
