/**
 * Contractor GenOffice — Object Storage barrel.
 *
 * Re-exports the public storage surface. The `./storage` package export
 * (see package.json) points here. Provider-agnostic — no S3/Azure/GCS
 * imports live behind this barrel; concrete providers implement the
 * `ObjectStore` interface without coupling the domain to any SDK.
 *
 * License: Apache-2.0.
 */

export * from './object-storage.js'
