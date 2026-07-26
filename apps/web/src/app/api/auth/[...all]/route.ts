import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@billow/auth";

export const { GET, POST } = toNextJsHandler(auth);
