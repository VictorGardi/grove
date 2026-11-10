// An error that the core sends to the client as a JSON-RPC failure with this code.
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}
