import { Moment } from "moment";

import { RepItemScheduleInfo } from "src/algorithms/base/rep-item-schedule-info";
import { SRSettings } from "src/settings";
import { DateUtil, globalDateProvider } from "src/utils/dates";

export class RepItemScheduleInfoOsr extends RepItemScheduleInfo {
    // A question can have multiple cards. The schedule info for all sibling cards are formatted together
    // in a single <!--SR: --> comment, such as:
    // <!--SR:!2023-09-02,4,270!2023-09-02,5,270!2023-09-02,6,270!2023-09-02,7,270-->
    //
    // However, not all sibling cards may have been reviewed. Therefore we need a method of indicating that a particular card
    // has not been reviewed, and should be considered "new"
    // This is done by using this magic value for the date
    public static dummyDueDateForNewCard: string = "2000-01-01";

    constructor(
        dueDate: Moment,
        interval: number,
        latestEase: number,
        delayedBeforeReviewTicks: number | null = null,
    ) {
        super();
        this.dueDate = dueDate;
        this.interval = Math.round(interval);
        this.latestEase = latestEase;
        this.delayedBeforeReviewTicks = delayedBeforeReviewTicks;
        if (dueDate && delayedBeforeReviewTicks == null) {
            this.delayedBeforeReviewTicks = globalDateProvider.today.valueOf() - dueDate.valueOf();
        }
    }

    formatCardScheduleForHtmlComment(): string {
        // If there's no schedule, return "New"
        if (!this.dueDate) {
            return "New";
        }
        return `!${this.formatDueDate()},${this.interval},${this.latestEase}`;
    }

    static get initialInterval(): number {
        return 1.0;
    }

    static getDummyScheduleForNewCard(settings: SRSettings): RepItemScheduleInfoOsr {
        return new RepItemScheduleInfoOsr(
            null,
            RepItemScheduleInfoOsr.initialInterval,
            settings.baseEase,
            null
        );
    }

    static fromDueDateStr(
        dueDateStr: string,
        interval: number,
        ease: number,
        delayedBeforeReviewTicks: number | null = null,
    ) {
        const dueDate: Moment = DateUtil.dateStrToMoment(dueDateStr);
        return new RepItemScheduleInfoOsr(dueDate, interval, ease, delayedBeforeReviewTicks);
    }
}
