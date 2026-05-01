import { BusyDots } from "./BusyDots";

interface WorkingPlaceholderProps {
  isWorking: boolean;
  statusText?: string | null;
}

export function WorkingPlaceholder({ isWorking }: WorkingPlaceholderProps) {
  if (!isWorking) return null;
  return <BusyDots />;
}
