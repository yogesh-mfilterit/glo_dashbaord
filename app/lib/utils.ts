import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format dbDate (YYYYMMDD) to readable format (dd MMM)
export function formatDbDate(dbDate: string): string {
  if (!dbDate || dbDate.length !== 8) return dbDate;
  
  const year = dbDate.substring(0, 4);
  const month = dbDate.substring(4, 6);
  const day = dbDate.substring(6, 8);
  
  const date = new Date(`${year}-${month}-${day}`);
  return date.toLocaleDateString('en-US', { 
    day: '2-digit', 
    month: 'short' 
  });
}
