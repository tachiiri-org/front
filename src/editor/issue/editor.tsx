import type { SpecNodeTaskStatus } from '../../spec/editor-schema';
import { issueStatuses, type IssueEntry } from '../../spec/issue-view';

import './issue.css';

type IssueEditorProps = {
  readonly issue: IssueEntry | null;
  readonly onChangeIssueText: (issueId: string, text: string) => void;
  readonly onChangeStatus: (status: SpecNodeTaskStatus) => void;
};

const taskStatusLabel: Record<SpecNodeTaskStatus, string> = {
  open: 'Open',
  proposed: 'Proposed',
  accepted: 'Accepted',
  done: 'Done',
};

export const IssueEditor = ({ issue, onChangeIssueText, onChangeStatus }: IssueEditorProps) => {
  if (!issue) {
    return (
      <section className="editor-panel issue-editor">
        <p className="editor-empty">Select an issue.</p>
      </section>
    );
  }

  return (
    <section className="editor-panel issue-editor">
      <div className="issue-editor__toolbar">
        <div className="issue-editor__title">{issue.text || 'Untitled issue'}</div>
        <label className="issue-editor__control issue-editor__control--inline">
          <span>Status</span>
          <select
            className="editor-select issue-editor__status-select"
            value={issue.status}
            onChange={(event) => onChangeStatus(event.target.value as SpecNodeTaskStatus)}
          >
            {issueStatuses.map((status) => (
              <option key={status} value={status}>
                {taskStatusLabel[status]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="issue-detail-outline">
        <textarea
          className="issue-detail-outline__textarea"
          lang="ja"
          spellCheck={false}
          rows={4}
          value={issue.text}
          onChange={(event) => onChangeIssueText(issue.id, event.target.value)}
        />
        <div className="issue-detail-outline__meta">
          <span>{issue.sourceNodePath.join(' > ')}</span>
          {issue.sourceLinkTarget ? <span>{issue.sourceLinkTarget}</span> : null}
        </div>
      </section>
    </section>
  );
};
