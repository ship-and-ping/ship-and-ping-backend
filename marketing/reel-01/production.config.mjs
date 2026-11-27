import { defineConfig } from "playwright/test";
export default defineConfig({testDir:".",testMatch:"production.spec.mjs",outputDir:".cache/production",
  reporter:"list",workers:1,timeout:900000,use:{channel:"chrome",viewport:{width:540,height:960}}});
