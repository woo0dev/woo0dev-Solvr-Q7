import fetch from "node-fetch";
import { parseISO, format, startOfWeek, startOfYear, getDay } from "date-fns";
import { Parser } from "json2csv";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";

interface Release {
  published_at: string;
  tag_name: string;
}

interface Repo {
  owner: string;
  repo: string;
}

interface StatRecord {
  repo: string;
  date: string;
  period: "day" | "week" | "year";
  count: number;
}

async function fetchReleases(owner: string, repo: string): Promise<Release[]> {
  let releases: Release[] = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`;
    const headers: any = {
      Accept: "application/vnd.github+json",
    };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch releases for ${owner}/${repo}: ${res.statusText}`);
    }
    
    const data = await res.json() as { published_at: string; tag_name: string }[];

    if (data.length === 0) break;

    releases = releases.concat(data.map((r: any) => ({
      published_at: r.published_at,
      tag_name: r.tag_name,
    })));
    page++;
  }
  return releases;
}

function groupByPeriod(releases: Release[], repo: string): StatRecord[] {
  const dayMap = new Map<string, number>();
  const weekMap = new Map<string, number>();
  const yearMap = new Map<string, number>();

  releases.forEach(({ published_at }) => {
    const date = parseISO(published_at);

    const dayOfWeek = getDay(date);
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return;
    }

    const dayKey = format(date, "yyyy-MM-dd");
    const weekStart = startOfWeek(date, { weekStartsOn: 1 });
    const weekKey = format(weekStart, "yyyy-'W'II");
    const yearKey = format(date, "yyyy");

    dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + 1);
    weekMap.set(weekKey, (weekMap.get(weekKey) ?? 0) + 1);
    yearMap.set(yearKey, (yearMap.get(yearKey) ?? 0) + 1);
  });

  const stats: StatRecord[] = [];

  dayMap.forEach((count, date) => {
    stats.push({ repo, date, period: "day", count });
  });
  weekMap.forEach((count, date) => {
    stats.push({ repo, date, period: "week", count });
  });
  yearMap.forEach((count, date) => {
    stats.push({ repo, date, period: "year", count });
  });

  return stats;
}

async function main() {
  const repos: Repo[] = [
    { owner: "daangn", repo: "stackflow" },
    { owner: "daangn", repo: "seed-design" },
  ];

  let allStats: StatRecord[] = [];

  for (const { owner, repo } of repos) {
    console.log(`Fetching releases for ${owner}/${repo}...`);
    const releases = await fetchReleases(owner, repo);
    console.log(`Fetched ${releases.length} releases.`);
    const stats = groupByPeriod(releases, repo);
    allStats = allStats.concat(stats);
  }

  const parser = new Parser({ fields: ["repo", "period", "date", "count"] });
  const csv = parser.parse(allStats);

  const outPath = path.resolve(process.cwd(), "release_stats.csv");
  fs.writeFileSync(outPath, csv);

  console.log(`CSV saved to ${outPath}`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
