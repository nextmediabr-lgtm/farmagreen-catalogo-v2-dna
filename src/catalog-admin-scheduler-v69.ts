import { GoogleAuth } from "google-auth-library";
import type { CatalogAdminEnvironmentV69 } from "./catalog-admin-v69.js";

export type SchedulerKindV69 = "daily" | "weekly";
export type SchedulerStateV69 = {
  kind: SchedulerKindV69;
  name: string;
  state: "ENABLED" | "PAUSED" | "DISABLED" | "UNKNOWN";
  schedule: string;
  timeZone: string;
  lastAttemptTime: string | null;
  nextScheduleTime: string | null;
  lastAttemptCode: number | null;
  simulated: boolean;
};

type CloudJob = {
  name?: string;
  state?: string;
  schedule?: string;
  timeZone?: string;
  lastAttemptTime?: string;
  scheduleTime?: string;
  status?: { code?: number };
};

const JOBS: Record<SchedulerKindV69, string> = {
  daily: "fg-v69-preprod-sync-0700-art",
  weekly: "fg-v69-weekly-discovery",
};
const LOCAL_STATES = new Map<string, Record<SchedulerKindV69, SchedulerStateV69>>();

function localJobs(environment: CatalogAdminEnvironmentV69) {
  const key = environment.V69_ADMIN_CONFIG_FILE || "default";
  let jobs = LOCAL_STATES.get(key);
  if (!jobs) {
    jobs = {
      daily: { kind: "daily", name: JOBS.daily, state: "ENABLED", schedule: "0 7,14 * * *", timeZone: "America/Argentina/Buenos_Aires", lastAttemptTime: null, nextScheduleTime: null, lastAttemptCode: null, simulated: true },
      weekly: { kind: "weekly", name: JOBS.weekly, state: "PAUSED", schedule: "0 4 * * 1", timeZone: "America/Argentina/Buenos_Aires", lastAttemptTime: null, nextScheduleTime: null, lastAttemptCode: null, simulated: true },
    };
    LOCAL_STATES.set(key, jobs);
  }
  return jobs;
}

export async function catalogCloudProjectV69(environment: CatalogAdminEnvironmentV69, auth: GoogleAuth) {
  const project = environment.GOOGLE_CLOUD_PROJECT?.trim() || await auth.getProjectId();
  if (!project || !/^[a-z][a-z0-9-]+$/.test(project)) {
    throw new Error("Proyecto de Google Cloud no configurado.");
  }
  return project;
}

async function cloudName(environment: CatalogAdminEnvironmentV69, kind: SchedulerKindV69, auth: GoogleAuth) {
  const project = await catalogCloudProjectV69(environment, auth);
  const region = environment.V69_DISCOVERY_JOB_REGION?.trim() || "southamerica-east1";
  if (!/^[a-z][a-z0-9-]+$/.test(region)) {
    throw new Error("Región de Cloud Scheduler no configurada.");
  }
  return `projects/${project}/locations/${region}/jobs/${JOBS[kind]}`;
}

function fromCloud(kind: SchedulerKindV69, job: CloudJob): SchedulerStateV69 {
  const state = job.state;
  return {
    kind,
    name: String(job.name || JOBS[kind]),
    state: state === "ENABLED" || state === "PAUSED" || state === "DISABLED" ? state : "UNKNOWN",
    schedule: String(job.schedule || ""),
    timeZone: String(job.timeZone || ""),
    lastAttemptTime: job.lastAttemptTime || null,
    nextScheduleTime: job.scheduleTime || null,
    lastAttemptCode: Number.isInteger(job.status?.code) ? Number(job.status?.code) : null,
    simulated: false,
  };
}

async function cloudRequest(environment: CatalogAdminEnvironmentV69, kind: SchedulerKindV69, action?: "pause" | "resume") {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const name = await cloudName(environment, kind, auth);
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Cloud Scheduler no entregó credenciales.");
  const response = await fetch(`https://cloudscheduler.googleapis.com/v1/${name}${action ? `:${action}` : ""}`, {
    method: action ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${token}`, ...(action ? { "content-type": "application/json" } : {}) },
    ...(action ? { body: "{}" } : {}),
  });
  if (!response.ok) throw new Error(`Cloud Scheduler respondió HTTP ${response.status} para ${kind}.`);
  return fromCloud(kind, await response.json() as CloudJob);
}

export function createCatalogSchedulerV69(environment: CatalogAdminEnvironmentV69) {
  const simulated = environment.NODE_ENV !== "production";
  return {
    async list() {
      if (simulated) return [structuredClone(localJobs(environment).daily), structuredClone(localJobs(environment).weekly)];
      return Promise.all([cloudRequest(environment, "daily"), cloudRequest(environment, "weekly")]);
    },
    async change(kind: SchedulerKindV69, action: "pause" | "resume", expectedState: string) {
      const current = simulated ? localJobs(environment)[kind] : await cloudRequest(environment, kind);
      if (current.state !== expectedState) throw new Error(`El cron ${kind} cambió a ${current.state}; actualizá el panel.`);
      if (action === "pause" && current.state !== "ENABLED") throw new Error("Sólo puede pausarse un cron habilitado.");
      if (action === "resume" && current.state !== "PAUSED") throw new Error("Sólo puede reanudarse un cron pausado.");
      if (simulated) {
        localJobs(environment)[kind].state = action === "pause" ? "PAUSED" : "ENABLED";
        return structuredClone(localJobs(environment)[kind]);
      }
      await cloudRequest(environment, kind, action);
      const verified = await cloudRequest(environment, kind);
      if (verified.state !== (action === "pause" ? "PAUSED" : "ENABLED")) {
        throw new Error("Cloud Scheduler no confirmó el cambio; verificá el estado antes de reintentar.");
      }
      return verified;
    },
  };
}
