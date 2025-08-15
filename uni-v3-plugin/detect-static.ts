import { parse } from '@vue/compiler-sfc'
import path from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'

// 配置项类型
type ReplacementFn = (
  originalPath: string,
  resolvedPath: string
) => string | null | undefined
export interface DetectStaticOptions {
  extensions?: string[]
  replacementFn?: ReplacementFn
  // 支持传入多个具名替换函数（可选），将依次尝试，返回第一个有效结果
  replacements?: Record<string, ReplacementFn>
  srcRoot?: string
  enableReplace?: boolean
  excludeUnused?: boolean
  additionalChecks?: Array<(filePath: string) => boolean>
}

// 内部结构类型
interface ImportInfo {
  originalPath: string
  resolvedPath: string
}
interface ReplacementLogEntry {
  type: string
  original: string
  replacement: string
}

export default function detectTemplateAssets(
  options: DetectStaticOptions = {}
): Plugin {
  const {
    extensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'],
    replacementFn,
    srcRoot = 'src',
    enableReplace = false, // 是否启用替换功能
    // 兼容传入多个命名替换函数（将逐个尝试）
    replacements,
    excludeUnused = true, // 新增选项：是否排除未使用资源
    additionalChecks = [], // 新增：额外的检查规则
  } = options

  const detectedAssets = new Set<string>()
  const importMap = new Map<
    string,
    { originalPath: string; resolvedPath: string }
  >()
  const replacementLog = new Map<
    string,
    Array<{ type: string; original: string; replacement: string }>
  >() // 记录替换日志

  const allAssets = new Set<string>()
  // 工具函数
  const isStaticAsset = (assetPath: string): boolean => {
    if (assetPath.startsWith('http') || assetPath.startsWith('data:')) {
      return false
    }
    if (!assetPath.includes('.')) {
      return false
    }
    const ext = path.extname(assetPath).toLowerCase()
    return extensions.includes(ext)
  }

  const resolvePath = (assetPath: string, currentFile: string): string => {
    if (assetPath.startsWith('@/')) {
      return path.resolve(srcRoot, assetPath.slice(2))
    }
    if (assetPath.startsWith('./') || assetPath.startsWith('../')) {
      const currentDir = path.dirname(currentFile)
      return path.resolve(currentDir, assetPath)
    }
    if (path.isAbsolute(assetPath)) {
      return assetPath
    }
    return path.resolve(srcRoot, assetPath)
  }

  const findReplacement = (
    resolvedPath: string,
    originalPath: string
  ): string => {
    // 只支持函数式替换
    if (typeof replacementFn === 'function') {
      const result = replacementFn(originalPath, resolvedPath)
      if (result) return result
    }
    return originalPath
  }

  const logReplacement = (
    type: string,
    original: string,
    replacement: string,
    file: string
  ): void => {
    if (!replacementLog.has(file)) {
      replacementLog.set(file, [])
    }
    const arr = replacementLog.get(file)
    if (arr) arr.push({ type, original, replacement })
  }
  // 扫描 src 目录下的所有静态资源
  const scanDirectory = (dir: string) => {
    if (!fs.existsSync(dir)) return

    const files = fs.readdirSync(dir, { withFileTypes: true })

    for (const file of files) {
      const fullPath = path.join(dir, file.name)

      if (file.isDirectory()) {
        scanDirectory(fullPath)
      } else {
        const ext = path.extname(file.name).toLowerCase()
        if (extensions.includes(ext)) {
          allAssets.add(fullPath)
        }
      }
    }
  }
  return {
    name: 'detect-static',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.vue')) return
      try {
        const { descriptor } = parse(code)
        let hasChanges = false
        let newCode = code

        // 处理 script 部分的 import
        if (descriptor.script || descriptor.scriptSetup) {
          const script = descriptor.script || descriptor.scriptSetup
          let scriptContent: string = script.content
          const importRegex =
            /import\s+(?:(\w+)|{([^}]+)}|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g
          let match: RegExpExecArray | null

          while ((match = importRegex.exec(scriptContent)) !== null) {
            const [
              fullMatch,
              defaultImport,
              namedImports,
              namespaceImport,
              importPath,
            ] = match

            if (isStaticAsset(importPath)) {
              const resolvedPath = resolvePath(importPath, id)

              if (defaultImport) {
                importMap.set(defaultImport, {
                  originalPath: importPath,
                  resolvedPath,
                })
                console.log(
                  `📦 检测到默认导入资源: ${defaultImport} -> ${importPath}==${resolvedPath}`
                )

                // 检查是否需要替换 import 路径
                if (enableReplace) {
                  const replacement = findReplacement(resolvedPath, importPath)
                  if (replacement) {
                    // 检查替换目标是否为线上地址
                    if (replacement.startsWith('http')) {
                      // 将 import 转换为变量赋值
                      const newStatement = `const ${defaultImport} = '${replacement}'`
                      scriptContent = scriptContent.replace(
                        fullMatch,
                        newStatement
                      )
                      logReplacement(
                        'import-to-url',
                        importPath,
                        replacement,
                        id
                      )
                      console.log(
                        `🔄 替换导入为URL变量: ${defaultImport} = '${replacement}'`
                      )
                    } else {
                      // 普通路径替换
                      const newImportStatement = fullMatch.replace(
                        importPath,
                        replacement
                      )
                      scriptContent = scriptContent.replace(
                        fullMatch,
                        newImportStatement
                      )
                      logReplacement('import', importPath, replacement, id)
                      console.log(
                        `🔄 替换导入路径: ${importPath} -> ${replacement}`
                      )
                    }
                    hasChanges = true
                  }
                }
              }
            }
          }

          // 更新 script 内容
          if (hasChanges && scriptContent !== script.content) {
            newCode = newCode.replace(script.content, scriptContent)
          }
        }

        // 处理 template 部分
        if (descriptor.template) {
          let templateContent = descriptor.template.content
          // 处理静态 src
          const staticSrcRegex = /(?<!:)src\s*=\s*["']([^"']+)["']/g
          templateContent = templateContent.replace(
            staticSrcRegex,
            (match: string, assetPath: string) => {
              if (isStaticAsset(assetPath)) {
                const resolvedPath = resolvePath(assetPath, id)
                detectedAssets.add(resolvedPath)
                console.log(
                  `📦 检测到静态资源: ${assetPath} -> ${resolvedPath}`
                )
                if (enableReplace) {
                  const replacement = findReplacement(resolvedPath, assetPath)
                  if (replacement) {
                    logReplacement(
                      'template-static',
                      assetPath,
                      replacement,
                      id
                    )
                    console.log(match.replace(assetPath, replacement))
                    return match.replace(assetPath, replacement)
                  }
                }
              }

              return match
            }
          )
          // 处理动态绑定
          const dynamicSrcRegex = /:src\s*=\s*["']([^"']+)["']/g
          templateContent = templateContent.replace(
            dynamicSrcRegex,
            (match: string, bindingValue: string) => {
              if (importMap.has(bindingValue)) {
                const rec = importMap.get(bindingValue)!
                const { resolvedPath } = rec
                detectedAssets.add(resolvedPath)
                console.log(
                  `📦 检测到动态绑定资源: ${bindingValue} -> ${resolvedPath}`
                )
              } else {
                console.log(
                  `⚠️  检测到动态绑定: ${bindingValue} (在 ${id}) - 需要手动检查`
                )
              }
              return match
            }
          )

          if (templateContent !== descriptor.template.content) {
            hasChanges = true
            newCode = newCode.replace(
              descriptor.template.content,
              templateContent
            )
          }
        }
        // style处理
        if (descriptor.styles && descriptor.styles.length > 0) {
          for (let i = 0; i < descriptor.styles.length; i++) {
            const style = descriptor.styles[i]
            let styleContent = style.content

            // 处理 CSS url()
            const urlRegex = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/g
            const newStyleContent = styleContent.replace(
              urlRegex,
              (match: string, assetPath: string) => {
                if (isStaticAsset(assetPath)) {
                  const resolvedPath = resolvePath(assetPath, id)
                  detectedAssets.add(resolvedPath)
                  console.log(
                    `📦 检测到CSS资源: ${assetPath} -> ${resolvedPath} (style块 ${
                      i + 1
                    })`
                  )

                  if (enableReplace) {
                    const replacement = findReplacement(resolvedPath, assetPath)
                    if (replacement) {
                      logReplacement('css-url', assetPath, replacement, id)
                      console.log(
                        `🔄 替换CSS资源: ${assetPath} -> ${replacement} (style块 ${
                          i + 1
                        })`
                      )
                      return match.replace(assetPath, replacement)
                    }
                  }
                }
                return match
              }
            )

            // 如果内容有变化，替换对应的 style 块
            if (newStyleContent !== styleContent) {
              hasChanges = true
              // 替换整个文件中对应的 style 内容
              newCode = newCode.replace(style.content, newStyleContent)
            }
          }
        }

        return hasChanges ? { code: newCode, map: null } : null
      } catch (error) {
        console.warn(`解析 Vue 文件失败: ${id}`, error)
      }
    },
    buildStart(options) {
      console.log('🔍 开始检测模板中的静态资源...')
      detectedAssets.clear()
      importMap.clear()
      replacementLog.clear()
      // 只扫描资源，不获取使用情况
      scanDirectory(srcRoot)
    },

    buildEnd() {
      console.log('\n📊 检测结果汇总:')
      console.log(`共扫描到 ${allAssets.size} 个静态资源`)
      console.log(`共检测到 ${detectedAssets.size} 个已使用资源:`)

      detectedAssets.forEach(asset => {
        console.log(`  ✅ ${path.relative(process.cwd(), asset)}`)
      })

      // 显示未使用的资源
      if (excludeUnused) {
        const unusedAssets = Array.from(allAssets).filter(
          asset => !detectedAssets.has(asset)
        )
        if (unusedAssets.length > 0) {
          console.log(`\n⚠️  发现 ${unusedAssets.length} 个未使用的资源:`)
          unusedAssets.forEach(asset => {
            console.log(`  ❌ ${path.relative(process.cwd(), asset)}`)
          })
          console.log('\n💡 这些资源已被阻止打包，建议手动删除以清理项目')
        }
      }

      if (enableReplace && replacementLog.size > 0) {
        console.log('\n🔄 替换操作汇总:')
        replacementLog.forEach((replacements, file) => {
          console.log(`\n文件: ${file}`)
          replacements.forEach(({ type, original, replacement }) => {
            console.log(`  [${type}] ${original} -> ${replacement}`)
          })
        })
      }
    },
    resolveId(id, importer) {
      const ext = path.extname(id).toLowerCase()
      if (extensions.includes(ext)) {
        let resolvedPath = id

        // 解析完整路径
        if (id.startsWith('@/')) {
          resolvedPath = path.resolve(srcRoot, id.replace('@/', ''))
        } else if (id.startsWith('./') || id.startsWith('../')) {
          resolvedPath = path.resolve(path.dirname(importer || ''), id)
        }

        resolvedPath = path.normalize(resolvedPath)

        // 如果启用了排除未使用资源功能
        if (excludeUnused && allAssets.has(resolvedPath)) {
          // 执行额外的检查规则
          let isUsedByAdditionalChecks = false
          additionalChecks.forEach(checkFn => {
            if (checkFn(resolvedPath)) {
              detectedAssets.add(resolvedPath)
              isUsedByAdditionalChecks = true
            }
          })

          // 如果资源未被检测到且未通过额外检查，阻止其加载
          if (!detectedAssets.has(resolvedPath) && !isUsedByAdditionalChecks) {
            console.log(
              `🚫 阻止未使用资源: ${path.relative(process.cwd(), resolvedPath)}`
            )
            return false // 阻止资源进入打包流程
          }
        }
      }
      return null
    },
  }
}
