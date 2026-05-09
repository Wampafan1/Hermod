import { validateBlueprintForStreaming } from "@/lib/bifrost/forge/forge-validator";
import {
  canAttachBlueprintStatus,
  normalizeBlueprintStatus,
} from "@/lib/mjolnir/blueprint-status";
import { loadBlueprintVersionForTenant } from "@/lib/mjolnir/blueprint-version-loader";

export type BifrostBlueprintStep = {
  type: string;
  order: number;
  config: Record<string, unknown>;
};

function normalizeBifrostSteps(steps: unknown): BifrostBlueprintStep[] {
  if (!Array.isArray(steps)) {
    throw new Error("Pinned blueprint version steps are invalid for streaming execution.");
  }

  return steps as BifrostBlueprintStep[];
}

export async function loadBifrostPinnedBlueprintVersion(input: {
  blueprintVersionId: string;
  tenantId: string | null;
}) {
  if (!input.tenantId) {
    throw new Error("Pinned blueprint version requires tenant context.");
  }

  const version = await loadBlueprintVersionForTenant({
    blueprintVersionId: input.blueprintVersionId,
    tenantId: input.tenantId,
  });

  if (!version) {
    throw new Error("Pinned blueprint version not found for this tenant.");
  }

  if (!version.isLocked) {
    throw new Error("Pinned blueprint version must be locked before execution.");
  }

  if (version.blueprint.scope !== "TENANT_PUBLISHED") {
    throw new Error("Pinned blueprint version is not tenant-published.");
  }

  const parentStatus = normalizeBlueprintStatus(version.blueprint.status);
  if (!canAttachBlueprintStatus(parentStatus)) {
    throw new Error(
      parentStatus === "ARCHIVED"
        ? "Archived pinned blueprint versions cannot be executed by Bifrost routes."
        : "Pinned blueprint version parent must be validated or active before Bifrost execution."
    );
  }

  const steps = normalizeBifrostSteps(version.steps);
  const validation = validateBlueprintForStreaming(steps);
  if (!validation.valid) {
    throw new Error(
      `Blueprint version contains stateful steps not supported in streaming mode: ${validation.statefulSteps.join(", ")}`
    );
  }

  return { version, steps };
}
