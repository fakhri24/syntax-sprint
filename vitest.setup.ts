import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL's automatic cleanup only registers when Vitest globals are enabled, and
// they are not. Without this, every render stays in document.body and `screen`
// queries start matching elements from earlier tests.
afterEach(cleanup);
