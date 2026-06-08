# 一个用于选择和测试不同 npm 镜像的命令行工具

支持 macOS、Windows、Linux，要求 Node.js >= 22。

## 安装
``` bash
npm i mirror-switching -g
```

## 使用方法
### 列出所有的可用的镜像
``` bash
zmp ls
```
### 选择镜像
``` bash
zmp use
```
选择后会同时修改 npm、pnpm、Yarn Modern 的 registry 配置；如果某个包管理器未安装，会自动跳过。

### 查看当前使用的镜像
``` bash
zmp current
```
会分别显示 npm、pnpm、Yarn Modern 当前使用的镜像。

### 测试镜像速度
``` bash
zmp ping
```
会测试所有内置镜像，按平均响应耗时排序，并给出最优推荐。

如果您在使用过程中遇到任何问题或者有建议，请随时在 [GitHub](https://github.com/Zephyr-Zhang99/mirror-switching) 上提出。
