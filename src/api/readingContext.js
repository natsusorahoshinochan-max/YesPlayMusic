let getIdentity;

export function configureMetadataReads({ getIdentity: read }) {
  if (typeof read !== 'function')
    throw new TypeError('Metadata reads require getIdentity');
  getIdentity = read;
}

export function readIdentity() {
  if (!getIdentity) throw new Error('Metadata reads have not been configured');
  return getIdentity();
}
