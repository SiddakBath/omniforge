import { decryptAtRest, encryptAtRest } from './crypto.js';
import { ensureOpenForgeDirs, OPENFORGE_PARAMS_FILE, readJsonFile, writeJsonFile } from './paths.js';
import type { ParamsStore, RequiredParam } from './types.js';

const EMPTY_PARAMS: ParamsStore = {
  values: {},
  secrets: {},
};

export async function loadParamsStore(): Promise<ParamsStore> {
  await ensureOpenForgeDirs();
  return readJsonFile<ParamsStore>(OPENFORGE_PARAMS_FILE, EMPTY_PARAMS);
}

export async function saveParamValue(param: RequiredParam, value: string): Promise<void> {
  const store = await loadParamsStore();
  if (param.secret) {
    store.secrets[param.key] = encryptAtRest(value);
  } else {
    store.values[param.key] = value;
  }
  await writeJsonFile(OPENFORGE_PARAMS_FILE, store);
}

export async function resolveParamValue(paramKey: string): Promise<string | undefined> {
  const store = await loadParamsStore();
  if (store.values[paramKey]) {
    return store.values[paramKey];
  }
  if (store.secrets[paramKey]) {
    return decryptAtRest(store.secrets[paramKey]);
  }
  return undefined;
}

export async function findMissingParams(requiredParams: RequiredParam[]): Promise<RequiredParam[]> {
  const store = await loadParamsStore();
  // Only return params that are truly required (required: true or undefined)
  return requiredParams.filter(
    (param) =>
      (param.required !== false) && // Default to required if not specified
      !(param.key in store.values) &&
      !(param.key in store.secrets)
  );
}
