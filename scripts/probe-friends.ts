import { writeFile } from "node:fs/promises";
import { getEnabledFriends } from "../src/config/friendsConfig.ts";

const TIME_ZONE = "Asia/Shanghai";
const REQUEST_TIMEOUT_MS = 6000;
const MAX_CONCURRENT_CHECKS = 4;
const SNAPSHOT_URL = new URL("../src/data/friends-latency-snapshot.json", import.meta.url);

type FriendLatencyState = "fast" | "normal" | "slow" | "down";

const normalizeFriendUrl = (url: string) =>
	url
		.trim()
		.replace(/^https?:\/\//i, "")
		.replace(/^www\./i, "")
		.replace(/\/+$/, "")
		.toLowerCase();

const classifyLatency = (milliseconds: number): Exclude<FriendLatencyState, "down"> => {
	if (milliseconds < 500) return "fast";
	if (milliseconds < 1000) return "normal";
	return "slow";
};

const getBeijingSlot = () => {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: TIME_ZONE,
		hour: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date());
	const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
	return hour < 14 ? "08:17" : "20:17";
};

const measureFriend = async (siteUrl: string) => {
	const checkedAt = new Date().toISOString();
	const startedAt = Date.now();
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const pingUrl = new URL(siteUrl);
		if (!/^https?:$/.test(pingUrl.protocol)) {
			return { state: "down" as const, checkedAt };
		}
		pingUrl.searchParams.set(
			"_friend_ping",
			`${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);

		const response = await fetch(pingUrl, {
			method: "GET",
			cache: "no-store",
			redirect: "follow",
			headers: { "user-agent": "rainzt.cn-friend-latency-probe/1.0" },
			signal: controller.signal,
		});
		await response.body?.cancel();

		const milliseconds = Math.max(1, Date.now() - startedAt);
		// HTTP 4xx/5xx means the site is reachable but not healthy.
		if (!response.ok) {
			return {
				state: "down" as const,
				checkedAt,
			};
		}
		return { state: classifyLatency(milliseconds), milliseconds, checkedAt };
	} catch {
		return { state: "down" as const, checkedAt };
	} finally {
		clearTimeout(timeoutId);
	}
};

const probeFriends = async () => {
	const queue = getEnabledFriends().map((friend) => friend.siteurl);
	const results: Record<string, Awaited<ReturnType<typeof measureFriend>>> = {};

	const worker = async () => {
		while (queue.length > 0) {
			const siteUrl = queue.shift();
			if (!siteUrl) return;
			results[normalizeFriendUrl(siteUrl)] = await measureFriend(siteUrl);
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_CHECKS, queue.length) }, () => worker()),
	);

	const snapshot = {
		version: 1,
		generatedAt: new Date().toISOString(),
		timezone: TIME_ZONE,
		slot: getBeijingSlot(),
		results,
	};
	await writeFile(SNAPSHOT_URL, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
	console.log(
		`Friend latency snapshot updated: ${Object.keys(results).length} sites, ${snapshot.slot} ${TIME_ZONE}`,
	);
};

await probeFriends();
