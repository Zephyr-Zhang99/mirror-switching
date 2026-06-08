#!/usr/bin/env node

const { execFile } = require('node:child_process');
const process = require('node:process');
const readline = require('node:readline/promises');
const { performance } = require('node:perf_hooks');
const { promisify } = require('node:util');
const mirrors = require('../npmMirrors.json');

const execFileAsync = promisify(execFile);
const MIRROR_KEYS = Object.keys(mirrors);
const PING_ATTEMPTS = 3;
const PING_TIMEOUT_MS = 5000;

const PACKAGE_MANAGERS = [
    {
        name: 'npm',
        command: 'npm',
        registryKey: 'registry',
    },
    {
        name: 'pnpm',
        command: 'pnpm',
        registryKey: 'registry',
    },
    {
        name: 'yarn',
        command: 'yarn',
        registryKey: 'npmRegistryServer',
    },
];

const commands = {
    ls: async () => {
        const list = MIRROR_KEYS.map((key) => `• ${key} - ${mirrors[key].registry}`);
        console.log(list.join('\n'));
        return 0;
    },
    use: async () => {
        const selectedKey = await selectMirror();
        if (!selectedKey) {
            return 1;
        }

        const registry = mirrors[selectedKey].registry;
        console.log(`设置镜像: ${selectedKey} - ${registry}`);

        const results = await Promise.all(
            PACKAGE_MANAGERS.map((manager) => setRegistry(manager, registry)),
        );

        results.forEach(printManagerConfigResult);
        return results.some((result) => result.status === 'success') ? 0 : 1;
    },
    current: async () => {
        console.log('查看当前源');

        const results = await Promise.all(PACKAGE_MANAGERS.map(getRegistry));
        results.forEach(printCurrentRegistryResult);

        return results.some((result) => result.status === 'success') ? 0 : 1;
    },
    ping: async () => {
        console.log(`测试镜像地址速度 (${PING_ATTEMPTS} 次请求，单次超时 ${PING_TIMEOUT_MS}ms)`);

        const results = await Promise.all(
            MIRROR_KEYS.map((key) => measureMirror(key, mirrors[key])),
        );

        results.sort((left, right) => {
            if (left.avg === null && right.avg === null) {
                return left.key.localeCompare(right.key);
            }
            if (left.avg === null) {
                return 1;
            }
            if (right.avg === null) {
                return -1;
            }
            return left.avg - right.avg;
        });

        console.log('\n镜像测速排行:');
        console.log('按平均响应耗时从低到高排序，失败的镜像排在最后。');
        results.forEach(printPingResult);
        printBestMirror(results);

        return results.some((result) => result.successCount > 0) ? 0 : 1;
    },
};

async function selectMirror() {
    console.log('请选择镜像:');
    MIRROR_KEYS.forEach((key, index) => {
        console.log(`${index + 1}.${key} - ${mirrors[key].registry}`);
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        const answer = await rl.question(`请输入您的选择 (1-${MIRROR_KEYS.length}): `);
        const index = Number.parseInt(answer, 10) - 1;

        if (index >= 0 && index < MIRROR_KEYS.length) {
            return MIRROR_KEYS[index];
        }

        console.log(`请选择1~${MIRROR_KEYS.length}`);
        return null;
    } finally {
        rl.close();
    }
}

async function setRegistry(manager, registry) {
    const result = await runConfigCommand(manager, [
        'config',
        'set',
        manager.registryKey,
        registry,
    ]);

    return {
        ...result,
        manager: manager.name,
        registry,
    };
}

async function getRegistry(manager) {
    const result = await runConfigCommand(manager, [
        'config',
        'get',
        manager.registryKey,
    ]);

    if (result.status !== 'success') {
        return {
            ...result,
            manager: manager.name,
        };
    }

    const registry = cleanConfigValue(result.stdout);
    return {
        ...result,
        manager: manager.name,
        registry,
        mirrorName: findMirrorName(registry),
    };
}

async function runConfigCommand(manager, args) {
    const invocation = createCommandInvocation(manager, args);

    try {
        const { stdout, stderr } = await execFileAsync(invocation.command, invocation.args, {
            encoding: 'utf8',
            windowsHide: true,
        });

        return {
            status: 'success',
            stdout,
            stderr,
        };
    } catch (error) {
        if (isCommandMissingError(error, manager)) {
            return {
                status: 'skipped',
                message: `未安装 ${manager.command}`,
            };
        }

        return {
            status: 'failed',
            message: getCommandError(error),
        };
    }
}

function createCommandInvocation(manager, args) {
    if (process.platform !== 'win32') {
        return {
            command: manager.command,
            args,
        };
    }

    return {
        command: process.env.ComSpec || 'cmd.exe',
        args: [
            '/d',
            '/c',
            buildWindowsCommand(`${manager.command}.cmd`, args),
        ],
    };
}

function buildWindowsCommand(command, args) {
    return [command, ...args].map(quoteWindowsCommandArgument).join(' ');
}

function quoteWindowsCommandArgument(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function isCommandMissingError(error, manager) {
    if (error.code === 'ENOENT') {
        return true;
    }

    if (process.platform !== 'win32') {
        return false;
    }

    const output = `${error.stderr || ''}\n${error.stdout || ''}\n${error.message || ''}`;
    const normalizedOutput = stripAnsi(output).toLowerCase();
    return normalizedOutput.includes(`${manager.command}.cmd`)
        && (
            normalizedOutput.includes('not recognized')
            || normalizedOutput.includes('不是内部或外部命令')
        );
}

function printManagerConfigResult(result) {
    if (result.status === 'success') {
        console.log(`[${result.manager}] 设置成功: ${result.registry}`);
        return;
    }

    if (result.status === 'skipped') {
        console.log(`[${result.manager}] skipped: ${result.message}`);
        return;
    }

    console.log(`[${result.manager}] 设置失败: ${result.message}`);
}

function printCurrentRegistryResult(result) {
    if (result.status === 'success') {
        const label = result.mirrorName
            ? `${result.mirrorName} - ${result.registry}`
            : result.registry;
        console.log(`[${result.manager}] 当前镜像: ${label}`);
        return;
    }

    if (result.status === 'skipped') {
        console.log(`[${result.manager}] skipped: ${result.message}`);
        return;
    }

    console.log(`[${result.manager}] 获取当前镜像失败: ${result.message}`);
}

async function measureMirror(key, mirror) {
    const baseUrl = normalizeBaseUrl(mirror.ping || mirror.registry);
    const attempts = [];

    for (let attempt = 0; attempt < PING_ATTEMPTS; attempt += 1) {
        attempts.push(await pingMirrorOnce(baseUrl));
    }

    const times = attempts
        .filter((attempt) => attempt.success)
        .map((attempt) => attempt.time);
    const errors = unique(
        attempts
            .filter((attempt) => !attempt.success)
            .map((attempt) => attempt.message),
    );

    return {
        key,
        registry: mirror.registry,
        successCount: times.length,
        total: PING_ATTEMPTS,
        avg: times.length ? Math.round(average(times)) : null,
        min: times.length ? Math.min(...times) : null,
        max: times.length ? Math.max(...times) : null,
        errors,
    };
}

async function pingMirrorOnce(baseUrl) {
    const pingUrl = joinUrl(baseUrl, '-/ping');

    try {
        return await timedFetch(pingUrl);
    } catch (pingError) {
        const packageUrl = joinUrl(baseUrl, 'npm');

        try {
            return await timedFetch(packageUrl);
        } catch (packageError) {
            return {
                success: false,
                message: `/-/ping: ${formatError(pingError)}; /npm: ${formatError(packageError)}`,
            };
        }
    }
}

async function timedFetch(url) {
    const start = performance.now();
    const response = await fetch(url, {
        headers: {
            accept: 'application/json',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });

    await response.arrayBuffer();

    const time = Math.round(performance.now() - start);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return {
        success: true,
        time,
    };
}

function printPingResult(result, index) {
    const latency = result.avg === null
        ? 'avg: --, min: --, max: --'
        : `avg: ${result.avg}ms, min: ${result.min}ms, max: ${result.max}ms`;
    const errors = result.errors.length
        ? `, errors: ${result.errors.slice(0, 2).join(' | ')}`
        : '';

    console.log(`${index + 1}. ${result.key} - ${result.registry}`);
    console.log(`   success: ${result.successCount}/${result.total}, ${latency}${errors}`);
}

function printBestMirror(results) {
    const best = results.find((result) => result.successCount > 0);

    if (!best) {
        console.log('\n最优推荐: 无可用镜像');
        return;
    }

    console.log(`\n最优推荐: ${best.key} - ${best.registry}`);
    console.log(`   avg: ${best.avg}ms, success: ${best.successCount}/${best.total}`);
}

function findMirrorName(registry) {
    const normalizedRegistry = normalizeRegistry(registry);

    return MIRROR_KEYS.find((key) => {
        const mirror = mirrors[key];
        return normalizeRegistry(mirror.registry) === normalizedRegistry
            || normalizeRegistry(mirror.ping) === normalizedRegistry;
    });
}

function cleanConfigValue(value) {
    return value.trim().replace(/^['"]|['"]$/g, '');
}

function normalizeRegistry(value = '') {
    return value.trim().replace(/\/+$/, '');
}

function normalizeBaseUrl(value) {
    return normalizeRegistry(value);
}

function joinUrl(baseUrl, path) {
    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function getCommandError(error) {
    const message = [error.stderr, error.stdout, error.message]
        .map((value) => (value || '').trim())
        .find(Boolean);

    return summarizeMessage(stripAnsi(message || '')) || '未知错误';
}

function formatError(error) {
    if (error.name === 'TimeoutError') {
        return `timeout ${PING_TIMEOUT_MS}ms`;
    }

    return error.message || String(error);
}

function summarizeMessage(message) {
    return message
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
}

function stripAnsi(value) {
    return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

async function main() {
    const command = process.argv[2] || '';

    if (commands[command]) {
        process.exitCode = await commands[command]();
        return;
    }

    console.log('无效的命令');
    console.log(`可用命令: ${Object.keys(commands).join(', ')}`);
    process.exitCode = 1;
}

main().catch((error) => {
    console.error(`执行失败: ${formatError(error)}`);
    process.exitCode = 1;
});
