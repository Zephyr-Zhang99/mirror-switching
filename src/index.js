#!/usr/bin/env node

const { exec } = require('child_process');
const readline = require('readline');
const mirrors = require('../npmMirrors.json');
const https = require('https');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const Keys = Object.keys(mirrors)
const commands = {
    ls: () => {
        const list = Keys.map((key) => {
            return `• ${key} - ${mirrors[key].registry}`
        })
        console.log(list.join('\n'));
        process.exit(0)
    },
    use: () => {
        console.log('请选择镜像:');
        Keys.forEach((key, index) => {
            console.log(`${index + 1}.${key} - ${mirrors[key].registry}`);
        });
        rl.question(`请输入您的选择 (1-${Keys.length}): `, (answer) => {
            rl.close();
            const index = parseInt(answer, 10) - 1;
            if (index >= 0 && index < Keys.length) {
                const selectedRegistry = Keys[index];
                exec(`npm config set registry ${mirrors[selectedRegistry].registry}`, (err, stdout, stderr) => {
                    if (err) {
                        console.log(`设置镜像失败: ${err}`);
                    } else {
                        console.log(`设置镜像成功: ${mirrors[selectedRegistry].registry}`);
                    }
                })
            } else {
                console.log(`请选择1~${Keys.length}`);
                rl.close();
            }
        });
    },
    current: () => {
        console.log('查看当前源');
        exec('npm config get registry', (err, stdout, stderr) => {
            if (!err) {
                Keys.forEach(k => {
                    if (mirrors[k].registry === stdout.trim()) {
                        console.log(`当前镜像: ${k} - ${mirrors[k].registry}`);
                    } else {
                        console.log(`当前镜像: ${stdout.trim()}`);
                    }
                    process.exit(0);
                })
            } else {
                console.log(`获取当前镜像失败: ${err}`);
            }
        })
    },
    ping: () => {
        console.log('测试镜像地址速度');
        console.log('请选择镜像:');
        Keys.forEach((key, index) => {
            console.log(`${index + 1}.${key} - ${mirrors[key].registry}`);
        });
        rl.question(`请输入您的选择 (1-${Keys.length}): `, (answer) => {
            const index = parseInt(answer, 10) - 1;
            if (index >= 0 && index < Keys.length) {
                const selectedRegistry = Keys[index];
                console.log(selectedRegistry);
                pingMirrorsSpeed(mirrors[selectedRegistry].registry)
            } else {
                console.log(`请选择1~${Keys.length}`);
                rl.close();
            }
        })
    },
};

function pingMirrorsSpeed(url) {
    const start = process.hrtime();
    const request = https.get(url, (response) => {
        const end = process.hrtime(start);
        const time = Math.round((end[0] * 1e9 + end[1]) / 1e6); // 毫秒
        console.log(`响应时长: ${time}ms`);
        process.exit(0)
    });
    request.on('error', (err) => {
        console.error(`请求错误: ${err.message}`);
        process.exit(0)
    });
}


const args = process.argv.slice(2);
const command = args[0] || '';
if (commands[command]) {
    commands[command]();
} else {
    console.log('无效的命令');
    process.exit(1);
}

