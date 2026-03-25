import { config } from "./config.js";
import { QiniuMaaSClient } from "./providers/qiniu-maas.js";

export function createMaaSClient(options = {}) {
  const providerPreset = options.providerPreset || config.providerPreset;
  if (providerPreset === "qiniu" || providerPreset === "sufy") {
    return new QiniuMaaSClient(options.runtimeOptions || config.qiniu);
  }
  throw new Error(`Unsupported MaaS provider preset: ${providerPreset}`);
}
