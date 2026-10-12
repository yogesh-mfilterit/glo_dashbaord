type CallbackType = "CAPTIVE" | "NON_CAPTIVE";

type TrfSrcCacheItem = {
  trfSrcName: string;
  callbackType: CallbackType;
};

const trfSrcCache: TrfSrcCacheItem[] = [];

/**
 * Returns true ONLY if same trfSrcName + same callbackType exists
 */
export function hasTrfSrc(
  trfSrcName: string,
  callbackType: CallbackType
): boolean {
  return trfSrcCache.some(
    (item) =>
      item.trfSrcName === trfSrcName &&
      item.callbackType === callbackType
  );
}

/**
 * Add a new trfSrc entry
 */
export function addTrfSrc(
  trfSrcName: string,
  callbackType: CallbackType
) {
  trfSrcCache.push({ trfSrcName, callbackType });
}

/**
 * Optional: useful for debugging
 */
export function getAllTrfSrc() {
  return trfSrcCache;
}
