
export type Priority = "high" | "medium" | "low";

function weight(p?: Priority){
  if(p==="high") return 3;
  if(p==="medium") return 2;
  return 1;
}

export function sortItems<T extends {priority?: Priority}>(items:T[]):T[]{
  return [...items].sort((a,b)=>weight(b.priority)-weight(a.priority));
}
