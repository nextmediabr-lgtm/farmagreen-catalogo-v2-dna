import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export type Product={publicId:string;slug:string;name:string;brand:{id:string;slug:string;name:string};line:string;primaryCategory:string;categorySlugs:string[];description:string;listPrice:number;offerPrice:number;savingAmount:number;discountPercent:number;images:{card:string;detail:string}};
export type Catalog={version:number;syncedAt:string;totalProducts:number;products:Product[]};
let cache:Catalog|null=null;
export async function catalog(){if(cache)return cache; const raw=JSON.parse(await fs.readFile(path.join(ROOT,"data","catalog.json"),"utf8")) as Catalog; cache={...raw,totalProducts:raw.products.length,products:raw.products.map(clean)}; return cache;}
export async function product(id:string){return (await catalog()).products.find(p=>p.slug===id||p.publicId===id);}
export async function similar(p:Product){return (await catalog()).products.filter(x=>x.publicId!==p.publicId).map(x=>({x,s:(x.brand.slug===p.brand.slug?5:0)+x.categorySlugs.filter(c=>p.categorySlugs.includes(c)).length*3+(x.discountPercent||0)/100})).filter(r=>r.s>0).sort((a,b)=>b.s-a.s).slice(0,8).map(r=>r.x);}
function clean(p:Product):Product{return{publicId:t(p.publicId),slug:t(p.slug),name:t(p.name),brand:{id:t(p.brand?.id),slug:t(p.brand?.slug),name:t(p.brand?.name)},line:t(p.line),primaryCategory:t(p.primaryCategory),categorySlugs:Array.isArray(p.categorySlugs)?p.categorySlugs.map(t):[],description:t(p.description),listPrice:n(p.listPrice),offerPrice:n(p.offerPrice),savingAmount:n(p.savingAmount),discountPercent:n(p.discountPercent),images:{card:t(p.images?.card),detail:t(p.images?.detail||p.images?.card)}}}
const t=(v:unknown)=>String(v||"").trim(); const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
