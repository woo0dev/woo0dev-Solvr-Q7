import fetch from "node-fetch";
import { parseISO, format, startOfWeek, startOfYear } from "date-fns";
import { Parser } from "json2csv";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
