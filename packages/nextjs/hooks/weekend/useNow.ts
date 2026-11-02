import { useEffect, useState } from "react";

/** The current time in seconds, refreshed every 30 seconds, for "5 minutes ago" and countdowns. */
export const useNow = () => {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
};
