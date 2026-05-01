OpenAI Image Relay (OpenAI 图像中继)

该 SillyTavern 第三方扩展会监控助手的回复内容，通过用户定义的正则表达式 (Regex) 提取提示词文本，将其发送至兼容 OpenAI 标准的后端，并将匹配到的提示词文本替换为生成的图像。



预设后端

默认设置指向：



服务地址： [http://127.0.0.1:8199/v1/chat/completions](http://127.0.0.1:8199/v1/chat/completions)

API 密钥： sk-any

模型： any

该配置匹配 https://github.com/lumingya/universal-web-api 的本地后端，但该扩展也支持其他任何兼容 OpenAI 接口规范的服务。

重要设置项

服务 URL (Service URL)： 接收完整的 .../chat/completions 链接，或者像 .../v1 这样的基础路径。

提示词正则 (Prompt regex)： 提取内容中捕获组 1 或名为 "prompt" 的命名组内容并发送至后端。

用户提示词模板 (User prompt template)： 在发送给后端之前，对提取出的提示词进行包装/修饰。

额外正文 JSON (Extra body JSON)： 可选参数，用于覆盖或添加特定后端所需的请求体字段。

响应解析逻辑

扩展会按以下顺序尝试解析返回的图像：



结构化图像字段： 例如返回数据中的 media 或 images 字段。

自定义响应正则： 根据用户配置的“响应图像正则表达式”进行匹配。

Markdown 链接： 在 choices[0].message.content（消息正文）中的 Markdown 格式图片链接。

宽泛匹配： 返回文本中包含的任何普通图像 URL。