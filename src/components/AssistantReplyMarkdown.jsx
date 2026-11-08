import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './assistantReplyMarkdown.css'

const plugins = [remarkGfm]
const elements = ['p','br','hr','h1','h2','h3','h4','h5','h6','strong','em','del','blockquote','ul','ol','li','pre','code','table','thead','tbody','tr','th','td','a']
const components = {
  table: ({children}) => <div className="reply-table-scroll" role="region" aria-label="Reply table" tabIndex={0}><table>{children}</table></div>,
  th: ({children,align}) => <th scope="col" style={{textAlign:align}}>{children}</th>,
  a: ({href,children}) => href ? <a href={href}>{children}</a> : children,
}
function webLink(value) {
  try {
    const url = new URL(value)
    return ['http:','https:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}
export default function AssistantReplyMarkdown({text}) {
  return <div className="assistant-reply-markdown"><Markdown remarkPlugins={plugins} allowedElements={elements} urlTransform={webLink} components={components}>{text}</Markdown></div>
}
