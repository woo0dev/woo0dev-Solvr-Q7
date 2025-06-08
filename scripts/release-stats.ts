import fetch from "node-fetch";
import { parseISO, format, startOfWeek, startOfYear, getDay, isWeekend, differenceInDays } from "date-fns";
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

interface RawRecord {
    repo_name: string;
    release_tag: string;
    period: "day";
    date: string;
    day_of_week: string;
    release_gap_days: number;
    avg_releases_per_period: number;
    release_count: number;
    cumulative_releases: number;
}

const DAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

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

function generateRawReleaseStats(releases: Release[], repo: string): RawRecord[] {
    const stats = groupByPeriod(releases, repo);
    const dayMap = new Map(stats.filter(s => s.period === "day").map(s => [s.date, s.count]));

    const rawStats: RawRecord[] = [];

    let prevDate: Date | null = null;
    let cumulative = 0;
    const firstDate = parseISO(releases[0].published_at);
    const lastDate = parseISO(releases[releases.length - 1].published_at);
    const totalDays = Math.max(differenceInDays(lastDate, firstDate), 1);

    releases.forEach((r, idx) => {
        const date = parseISO(r.published_at);
        const dateStr = format(date, "yyyy-MM-dd");
        const dayOfWeek = getDay(date);
        const gap = prevDate ? differenceInDays(date, prevDate) : 0;
        const releaseCount = dayMap.get(dateStr) ?? 0;
        cumulative += 1;

        rawStats.push({
            repo_name: repo,
            release_tag: r.tag_name,
            period: "day",
            date: dateStr,
            day_of_week: DAY_NAMES[dayOfWeek],
            release_gap_days: gap,
            avg_releases_per_period: Number((releases.length / totalDays).toFixed(2)),
            release_count: releaseCount,
            cumulative_releases: cumulative,
        });

        prevDate = date;
    });

    return rawStats;
}

async function main() {
    const repos: Repo[] = [
        { owner: "daangn", repo: "stackflow" },
        { owner: "daangn", repo: "seed-design" },
    ];

    let allStats: StatRecord[] = [];
    let allRawStats: RawRecord[] = [];

    for (const { owner, repo } of repos) {
        console.log(`Fetching releases for ${owner}/${repo}...`);
        const releases = await fetchReleases(owner, repo);
        console.log(`Fetched ${releases.length} releases.`);
        const stats = groupByPeriod(releases, repo);
        const rawStats = generateRawReleaseStats(releases, repo);
        allStats = allStats.concat(stats);
        allRawStats = allRawStats.concat(rawStats);
    }

    const summaryParser = new Parser({ fields: ["repo", "period", "date", "count"] });
    const rawParser = new Parser({
        fields: [
            "repo_name",
            "release_tag",
            "period",
            "date",
            "day_of_week",
            "release_gap_days",
            "avg_releases_per_period",
            "release_count",
            "cumulative_releases",
        ]
    });

    fs.writeFileSync(path.resolve(process.cwd(), "release_stats.csv"), summaryParser.parse(allStats));
    fs.writeFileSync(path.resolve(process.cwd(), "release-raw.csv"), rawParser.parse(allRawStats));

    console.log("CSV saved to release_stats.csv and release-raw.csv");
}

main().catch((e) => {
    console.error("Error:", e);
    process.exit(1);
});
