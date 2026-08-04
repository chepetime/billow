import { describe, expect, it, vi } from "vitest";

import { createRetryExtension } from "./index";

/** A connection-reset error shaped like the ones Prisma throws mid-query. */
function connectionResetError() {
  return Object.assign(new Error("Connection terminated unexpectedly"), {
    code: "P1017",
  });
}

/**
 * Invokes the extension's $allOperations hook the same way Prisma's query
 * engine does: pass the operation name and a `query` stand-in for the actual
 * database call.
 */
function runAllOperations(
  operation: string,
  query: (args: unknown) => Promise<unknown>,
) {
  const extension = createRetryExtension();
  return extension.query.$allOperations({ operation, args: {}, query });
}

describe("createRetryExtension", () => {
  it("retries a read operation after a transient connection error", async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(connectionResetError())
      .mockResolvedValueOnce("read-result");

    await expect(runAllOperations("findMany", query)).resolves.toBe(
      "read-result",
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not retry a mutation after a transient connection error, and surfaces it", async () => {
    const error = connectionResetError();
    const query = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("would-be-replayed");

    await expect(runAllOperations("create", query)).rejects.toBe(error);
    // Exactly one attempt: a second call would mean the write was replayed
    // after an ambiguous failure, which is the bug this extension must not
    // reintroduce.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("leaves a successful mutation unaffected", async () => {
    const query = vi.fn().mockResolvedValueOnce("created-row");

    await expect(runAllOperations("create", query)).resolves.toBe(
      "created-row",
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("does not retry $executeRaw even though $queryRaw is retried", async () => {
    const readQuery = vi
      .fn()
      .mockRejectedValueOnce(connectionResetError())
      .mockResolvedValueOnce([{ ok: true }]);
    await expect(runAllOperations("$queryRaw", readQuery)).resolves.toEqual([
      { ok: true },
    ]);
    expect(readQuery).toHaveBeenCalledTimes(2);

    const writeError = connectionResetError();
    const writeQuery = vi
      .fn()
      .mockRejectedValueOnce(writeError)
      .mockResolvedValueOnce(1);
    await expect(runAllOperations("$executeRaw", writeQuery)).rejects.toBe(
      writeError,
    );
    expect(writeQuery).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-connection error even for a read operation", async () => {
    const notFound = new Error("Record not found");
    const query = vi.fn().mockRejectedValueOnce(notFound);

    await expect(runAllOperations("findUnique", query)).rejects.toBe(notFound);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
