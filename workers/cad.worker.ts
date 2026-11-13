import { setOC } from "replicad";
import { buildPlate } from "../lib/cad/interpreter";
import { buildScene } from "../lib/cad/scene-interpreter";
import { validateScene } from "../lib/cad/scene";
import { plateSchema, type WorkerMessage } from "../lib/cad/schema";

const send = (message: WorkerMessage, transfer: Transferable[] = []) =>
  self.postMessage(message, { transfer });
self.onmessage = async (event: MessageEvent<unknown>) => {
  try {
    const isScene =
      typeof event.data === "object" &&
      event.data !== null &&
      "parts" in event.data;
    const parameters = isScene
      ? validateScene(event.data)
      : plateSchema.parse(event.data);
    send({
      type: "progress",
      progress: 8,
      message: "OpenCascade 엔진 불러오는 중 · 첫 실행은 잠시 걸립니다",
    });
    // Keep Emscripten's Node-only branches outside the browser bundler.
    // This module and WASM are copied from the pinned package at install time.
    const moduleUrl = "/wasm/replicad_single.js";
    const { default: initOpenCascade } = (await import(
      /* webpackIgnore: true */ moduleUrl
    )) as typeof import("replicad-opencascadejs");
    const oc = await initOpenCascade({
      locateFile: (file: string) => `/wasm/${file}`,
    });
    setOC(oc);
    const report = (progress: number, message: string) =>
      send({ type: "progress", progress, message });
    const result = isScene
      ? await buildScene(parameters as import("../lib/cad/scene").Scene, report)
      : await buildPlate(
          parameters as import("../lib/cad/schema").PlateParameters,
          report,
        );
    send({ type: "result", result }, [result.step]);
  } catch (error) {
    send({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "CAD 엔진에서 오류가 발생했습니다. 다시 시도해주세요.",
    });
  }
};
