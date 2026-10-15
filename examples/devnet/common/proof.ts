// Decoders for the hash, mask, and proof fields of the V4 validation API responses

// Accepts number[] / Buffer / Uint8Array, or a hex or base64 string
export function parseHash(rawData: any): number[] {
  if (typeof rawData === 'string') {
    const buf = rawData.length === 64 ? Buffer.from(rawData, 'hex') : Buffer.from(rawData, 'base64')
    return Array.from(buf)
  }
  return Array.from(rawData)
}

export function parseMask(rawData: any): number[] {
  const bytes = parseHash(rawData)
  if (bytes.length !== 512) throw new Error(`rawMask must be 512 bytes, got ${bytes.length}`)
  return bytes
}

export function parseProofNode(node: any) {
  return { hash: parseHash(node.hash), isRightSibling: node.isRightSibling }
}

// Odds proof nodes; a single-update subtree has no siblings, and the server omits the empty proof
export function parseOddsProofNodes(nodes: { hash: any, isRightSibling: boolean }[] = []) {
  return nodes.map(node => ({ hash: Array.from(node.hash) as number[], isRightSibling: node.isRightSibling }))
}
