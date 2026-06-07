import "dotenv/config";

import { ingestAttackKbDataItem, ingestAttackKbSource } from "./ingestion/index.js";
import { buildSampleMaestroDataItem, sampleOwaspAgenticSource } from "./ingestion/sample.js";
import { closeDefaultAttackKbStorageAdapter } from "./storage/index.js";

try {
  const sourceResult = await ingestAttackKbSource(sampleOwaspAgenticSource);
  const dataItemResult = await ingestAttackKbDataItem(
    buildSampleMaestroDataItem(sourceResult.object.id),
  );

  console.log(
    JSON.stringify(
      {
        message:
          "Manual Attack KB ingestion complete. No OpenAI call was made; Weave tracing is enabled only when WANDB_API_KEY is set.",
        source: {
          id: sourceResult.object.id,
          category: sourceResult.object.payload.category,
          provenance: sourceResult.object.payload.provenance,
          evidence: sourceResult.object.payload.evidence,
        },
        dataItem: {
          id: dataItemResult.object.id,
          category: dataItemResult.object.payload.provenance.category,
          sourceRef: dataItemResult.object.payload.sourceRef,
          provenance: dataItemResult.object.payload.provenance,
          evidence: dataItemResult.object.payload.evidence,
        },
        curationCandidates: [sourceResult.curationCandidate, dataItemResult.curationCandidate],
        curationFlows: [sourceResult.curationFlow, dataItemResult.curationFlow],
        trace: {
          source: sourceResult.weaveTrace,
          dataItem: dataItemResult.weaveTrace,
        },
        storage: sourceResult.storage,
      },
      null,
      2,
    ),
  );
} finally {
  await closeDefaultAttackKbStorageAdapter();
}
