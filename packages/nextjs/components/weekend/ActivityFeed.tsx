"use client";

import { Empty } from "~~/components/weekend/ui";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useActivity } from "~~/hooks/weekend/useActivity";
import { getBlockExplorerTxLink } from "~~/utils/scaffold-eth";

/** What has happened on this set of contracts, in plain sentences, each linked to its transaction. */
export const ActivityFeed = () => {
  const { targetNetwork } = useTargetNetwork();
  const { data, isLoading, isError } = useActivity();

  if (isLoading) return <Empty>Reading recent events…</Empty>;
  if (isError) return <Empty>Couldn&apos;t read events from the network. They&apos;ll appear when it responds.</Empty>;
  if (!data?.length) return <Empty>Nothing has happened on this set of contracts yet.</Empty>;

  return (
    <ul className="m-0 list-none divide-y divide-base-200 p-0">
      {data.map(item => {
        const link = getBlockExplorerTxLink(targetNetwork.id, item.hash);
        return (
          <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
            <span>
              <span className="font-medium">{item.title}.</span>{" "}
              <span className="text-base-content/70">{item.detail}.</span>
            </span>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className="link text-xs">
                View transaction
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
};
