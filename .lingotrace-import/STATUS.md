# LingoTrace 冻结候选源码完整可恢复归档

本分支保留候选 b8285030fe8889a1de894f7cfe4ecb91b4d3746a 的 670 个源码文件身份：643 个直接文本与 23 个直接资源文件；另 4 个大资源路径对应 3 份原件，按 9 个精确分片保存在本分支的 resources/blobs 目录。

直接打开分支时，4 个大资源路径尚未展开。GitHub 工具单次请求有 16 MiB 传输上限；分片是原件的无损保存，不是替代资源或 LFS 指针。克隆本分支后，在仓库根目录运行：

    python3 .lingotrace-import/restore-source.py

脚本不联网、不安装依赖。它先核对已有源码和全部分片的大小、SHA-256 与 Git blob SHA-1，再展开 4 个路径，最后逐项核对全部 670 个文件和来源树身份。已有文件若内容不同会停止，不覆盖用户改动。再次只读核对：

    python3 .lingotrace-import/restore-source.py --verify-only

完整清单见 SOURCE-MANIFEST.json。源码投影树为 c8a344b1f1d864f944c0370c5bed3be6e80f8fa3；它不包括生成 dist、历史依赖或本归档工具，不能冒充原始完整 Git 提交。原仓库初始化 README 仍保存在 github-initial-README.md。

原有 42 份总纲/详细 PRD 增补随源码保留。独立 Word/PDF 原件不计入这 670 个源码文件，其归档进度单独记录。文档归档不代表全部需求已实现。

该冻结候选仍未完成全量测试、构建和设备验收，本次没有部署网站。分片远端路径、大小和 blob 身份已核对；恢复脚本在本地原始分片上测试通过。没有宣称远端大二进制全文下载回读已通过。
