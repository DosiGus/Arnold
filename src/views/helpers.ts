/* eslint-disable @typescript-eslint/no-explicit-any -- temporary: untyped Skybridge hooks until the typed Arnold client replaces this file */
import {
  useCallTool as useCallToolBase,
  useToolInfo as useToolInfoBase,
} from "skybridge/web";

export const useToolInfo = <_T extends string>() =>
  useToolInfoBase<any>() as any;
export const useCallTool = (name: string) =>
  useCallToolBase<any, any>(name) as any;
