import type { OpResultData, PingParams } from "@aes/shared/ae";
import { JSX_VERSION } from "../../shared/constants";

/** Diagnostika: AE versiyasi, ochiq loyiha, jsx versiyasi. */
export function ping(params: PingParams, opId: string): OpResultData {
  const file = app.project.file;
  return {
    op_id: opId,
    reused: false,
    info: {
      ae_version: app.version,
      jsx_version: JSX_VERSION,
      project_path: file === null ? null : file.fsName,
      os: $.os,
      echo: params.echo === undefined ? null : params.echo,
    },
  };
}
